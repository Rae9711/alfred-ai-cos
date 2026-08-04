import Photos
import UIKit
import Vision

/// Fetch the newest system screenshot, OCR chat bubbles, then delete the asset.
enum AlfredScreenshotImporter {
    struct Bubble: Equatable {
        let text: String
        let isSelf: Bool
    }

    struct Result {
        let bubbles: [Bubble]
        let assetLocalId: String?
    }

    enum ImportError: Error, LocalizedError {
        case noPermission
        case noRecentScreenshot
        case ocrFailed
        case emptyText

        var errorDescription: String? {
            switch self {
            case .noPermission: return "需要相册权限以读取截图"
            case .noRecentScreenshot: return "未找到最近截图 — 请先截一张当前聊天"
            case .ocrFailed: return "截图识别失败"
            case .emptyText: return "截图里没有识别到文字"
            }
        }
    }

    /// Screenshots created within this window are eligible.
    static let recencySeconds: TimeInterval = 45

    static func authorizationStatus() -> PHAuthorizationStatus {
        if #available(iOS 14, *) {
            return PHPhotoLibrary.authorizationStatus(for: .readWrite)
        }
        return PHPhotoLibrary.authorizationStatus()
    }

    static func requestAccess() async -> Bool {
        await withCheckedContinuation { cont in
            if #available(iOS 14, *) {
                PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                    cont.resume(returning: status == .authorized || status == .limited)
                }
            } else {
                PHPhotoLibrary.requestAuthorization { status in
                    cont.resume(returning: status == .authorized)
                }
            }
        }
    }

    /// Load newest screenshot in the recency window, OCR it, delete the asset.
    static func ingestRecentScreenshot(deleteAfter: Bool = true) async throws -> Result {
        let status = authorizationStatus()
        let ok: Bool
        switch status {
        case .authorized, .limited:
            ok = true
        case .notDetermined:
            ok = await requestAccess()
        default:
            ok = false
        }
        guard ok else { throw ImportError.noPermission }

        guard let asset = fetchNewestScreenshot() else {
            throw ImportError.noRecentScreenshot
        }

        let image = try await requestImage(for: asset)
        let bubbles = try await recognizeBubbles(in: image)
        guard !bubbles.isEmpty else { throw ImportError.emptyText }

        let localId = asset.localIdentifier
        if deleteAfter {
            try? await deleteAsset(asset)
        }
        return Result(bubbles: bubbles, assetLocalId: localId)
    }

    /// True when a screenshot exists that is newer than `recencySeconds`.
    static func hasRecentScreenshot() -> Bool {
        fetchNewestScreenshot() != nil
    }

    // MARK: - Photos

    private static func fetchNewestScreenshot() -> PHAsset? {
        let opts = PHFetchOptions()
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        opts.fetchLimit = 20
        let result = PHAsset.fetchAssets(with: .image, options: opts)
        let cutoff = Date().addingTimeInterval(-recencySeconds)
        var firstShot: PHAsset?
        result.enumerateObjects { asset, _, stop in
            guard let created = asset.creationDate, created >= cutoff else { return }
            guard asset.mediaSubtypes.contains(.photoScreenshot) else { return }
            firstShot = asset
            stop.pointee = true
        }
        return firstShot
    }

    private static func requestImage(for asset: PHAsset) async throws -> UIImage {
        try await withCheckedThrowingContinuation { cont in
            let opts = PHImageRequestOptions()
            opts.deliveryMode = .highQualityFormat
            opts.isNetworkAccessAllowed = true
            opts.isSynchronous = false
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: opts) {
                data, _, _, info in
                if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
                    cont.resume(throwing: ImportError.ocrFailed)
                    return
                }
                if let error = info?[PHImageErrorKey] as? Error {
                    cont.resume(throwing: error)
                    return
                }
                guard let data, let image = UIImage(data: data) else {
                    cont.resume(throwing: ImportError.ocrFailed)
                    return
                }
                cont.resume(returning: image)
            }
        }
    }

    private static func deleteAsset(_ asset: PHAsset) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.deleteAssets([asset] as NSArray)
            }, completionHandler: { success, error in
                if let error {
                    cont.resume(throwing: error)
                } else if success {
                    cont.resume(returning: ())
                } else {
                    cont.resume(throwing: ImportError.ocrFailed)
                }
            })
        }
    }

    // MARK: - Vision OCR

    private struct Obs {
        let text: String
        let box: CGRect // Vision normalized: origin bottom-left, 0...1
    }

    private static func recognizeBubbles(in image: UIImage) async throws -> [Bubble] {
        guard let cg = image.cgImage else { throw ImportError.ocrFailed }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]

        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        try handler.perform([request])
        let observations = request.results ?? []
        let obs: [Obs] = observations.compactMap { o in
            guard let candidate = o.topCandidates(1).first else { return nil }
            let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return Obs(text: text, box: o.boundingBox)
        }
        guard !obs.isEmpty else { return [] }

        // Cluster by vertical proximity (Vision y is bottom-up).
        let sorted = obs.sorted { $0.box.midY > $1.box.midY } // top of screen first
        var clusters: [[Obs]] = []
        let yJoin: CGFloat = 0.035
        for item in sorted {
            if var last = clusters.last, let prev = last.last,
               abs(prev.box.midY - item.box.midY) < yJoin
            {
                last.append(item)
                clusters[clusters.count - 1] = last
            } else {
                clusters.append([item])
            }
        }

        let midX: CGFloat = 0.5
        var bubbles: [Bubble] = []
        for cluster in clusters {
            let ordered = cluster.sorted { $0.box.minX < $1.box.minX }
            let text = ordered.map(\.text).joined(separator: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard text.count >= 1 else { continue }
            // Skip obvious chrome
            if isChrome(text) { continue }
            let avgX = ordered.map(\.box.midX).reduce(0, +) / CGFloat(ordered.count)
            let isSelf = avgX >= midX
            bubbles.append(Bubble(text: text, isSelf: isSelf))
        }
        return bubbles
    }

    private static func isChrome(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.count <= 1 { return true }
        let lower = t.lowercased()
        let blocked: Set<String> = [
            "微信", "wechat", "whatsapp", "instagram", "messages", "信息",
            "今天", "昨天", "取消", "发送", "send", "search", "搜索",
        ]
        if blocked.contains(lower) { return true }
        // Pure clock like 12:34
        if t.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil {
            return true
        }
        return false
    }
}
