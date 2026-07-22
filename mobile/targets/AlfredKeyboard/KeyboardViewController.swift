import UIKit

/// Custom keyboard state machine (mockup-aligned):
/// IDLE → IMPORTING → CONTEXT_INSIGHT → GENERATING → REPLY_READY → EDITING → SUCCESS
final class KeyboardViewController: UIInputViewController {
    private enum Phase {
        case idle
        case importing
        case contextInsight
        case generating
        case replyReady
        case editing
        case success
        case error(String)
    }

    private let root = UIStackView()
    private let contentScroll = UIScrollView()
    private let contentStack = UIStackView()
    private let chromeBar = UIStackView()
    private var heightConstraint: NSLayoutConstraint?

    private var phase: Phase = .idle
    private var conversationJSON: [String: Any]?
    private var conversationId: String?
    private var parsedMessages: [AlfredKeyboardAPI.Message] = []
    private var selectedMessageIds: Set<String> = []
    private var replies: [AlfredKeyboardAPI.Reply] = []
    private var replyIndex = 0
    private var actions: [AlfredKeyboardAPI.Action] = []
    private var insight: String = ""
    private var editTextView: UITextView?
    private var charCountLabel: UILabel?
    private var statusBanner: String?
    private var generatingStep = 0
    private var generatingTimer: Timer?
    private var generatingComplete = false
    private var clipboardHintCount: Int?

    /// Target height closer to a stock iOS custom keyboard (~260–280pt).
    private let preferredKeyboardHeight: CGFloat = 272

    // Mockup palette — cool white / light gray / deep blue (not beige paper)
    private let accent = UIColor(red: 0.12, green: 0.28, blue: 0.62, alpha: 1)
    private let accentSoft = UIColor(red: 0.86, green: 0.91, blue: 0.98, alpha: 1)
    private let panel = UIColor(red: 0.97, green: 0.97, blue: 0.98, alpha: 1)
    private let bubbleFill = UIColor(red: 0.90, green: 0.94, blue: 1.0, alpha: 1)
    /// Explicit dark body text — `.secondaryLabel` is near-invisible on white
    /// when the host app (e.g. WeChat) forces a dark trait collection.
    private let bodyText = UIColor(red: 0.18, green: 0.20, blue: 0.24, alpha: 1)
    private let mutedText = UIColor(red: 0.35, green: 0.38, blue: 0.42, alpha: 1)
    private let maxEditChars = 200

    private let generatingLabels = [
        "解析聊天内容",
        "理解情绪与意图",
        "提取关键信息",
        "生成回复建议…",
    ]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        AlfredAppGroup.markKeyboardSeen()
        setupChrome()
        render()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        AlfredAppGroup.markKeyboardSeen()
        // Re-read hasFullAccess / App Group / token every time the keyboard
        // becomes visible. Settings → Allow Full Access kills or backgrounds the
        // extension; without this, a stale gate banner (or .error from a prior
        // tap) can linger until the process restarts.
        switch phase {
        case .idle:
            clipboardHintCount = estimateClipboardMessageCount()
            render()
        case .error(let message) where Self.authGateCopy.contains(message):
            phase = .idle
            clipboardHintCount = estimateClipboardMessageCount()
            render()
        default:
            break
        }
    }

    deinit {
        generatingTimer?.invalidate()
    }

    // MARK: - Layout

    private func setupChrome() {
        root.axis = .vertical
        root.spacing = 4
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)

        let height = view.heightAnchor.constraint(equalToConstant: preferredKeyboardHeight)
        height.priority = .required
        heightConstraint = height

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            root.topAnchor.constraint(equalTo: view.topAnchor, constant: 4),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -2),
            height,
        ])

        contentScroll.translatesAutoresizingMaskIntoConstraints = false
        contentScroll.showsVerticalScrollIndicator = false
        contentScroll.alwaysBounceVertical = false
        contentScroll.isScrollEnabled = false
        contentStack.axis = .vertical
        contentStack.spacing = 4
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        contentScroll.addSubview(contentStack)
        root.addArrangedSubview(contentScroll)

        chromeBar.axis = .horizontal
        chromeBar.spacing = 6
        chromeBar.distribution = .fill
        chromeBar.alignment = .center
        chromeBar.setContentHuggingPriority(.required, for: .vertical)
        chromeBar.setContentCompressionResistancePriority(.required, for: .vertical)
        root.addArrangedSubview(chromeBar)

        // Content fills leftover space above chrome; no fixed min height that
        // forces the panel taller than preferredKeyboardHeight.
        let scrollFill = contentScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 1)
        scrollFill.priority = .defaultLow
        NSLayoutConstraint.activate([
            scrollFill,
            contentStack.leadingAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.leadingAnchor),
            contentStack.trailingAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.trailingAnchor),
            contentStack.topAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.topAnchor),
            contentStack.bottomAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.bottomAnchor),
            contentStack.widthAnchor.constraint(equalTo: contentScroll.frameLayoutGuide.widthAnchor),
        ])
    }

    private func clearContent() {
        contentStack.arrangedSubviews.forEach {
            contentStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        chromeBar.arrangedSubviews.forEach {
            chromeBar.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        editTextView = nil
        charCountLabel = nil
    }

    /// Scroll only when dense phases can overflow the fixed keyboard height.
    private func updateScrollPolicy() {
        switch phase {
        case .contextInsight, .replyReady, .editing, .success:
            contentScroll.isScrollEnabled = true
            contentScroll.showsVerticalScrollIndicator = true
        default:
            contentScroll.isScrollEnabled = false
            contentScroll.showsVerticalScrollIndicator = false
            contentScroll.contentOffset = .zero
        }
    }

    private func render() {
        clearContent()
        contentStack.spacing = 4
        renderHeader()
        switch phase {
        case .idle: renderIdle()
        case .importing: renderImporting()
        case .contextInsight: renderContextInsight()
        case .generating: renderGenerating()
        case .replyReady: renderReplyReady()
        case .editing: renderEditing()
        case .success: renderSuccess()
        case .error(let msg): renderError(msg)
        }
        renderChrome()
        updateScrollPolicy()
    }

    // MARK: - Header / chrome

    private func renderHeader() {
        let row = UIStackView()
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 4

        let brand = makeLabel("Alfred", size: 14, weight: .bold, color: accent)
        row.addArrangedSubview(brand)

        let sparkle = UIImageView(image: UIImage(systemName: "sparkles"))
        sparkle.tintColor = accent
        sparkle.contentMode = .scaleAspectFit
        sparkle.widthAnchor.constraint(equalToConstant: 12).isActive = true
        sparkle.heightAnchor.constraint(equalToConstant: 12).isActive = true
        row.addArrangedSubview(sparkle)

        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        row.addArrangedSubview(spacer)

        let collapse = UIButton(type: .system)
        let chevron = UIImage(systemName: "chevron.down")
        collapse.setImage(chevron, for: .normal)
        collapse.tintColor = mutedText
        collapse.addTarget(self, action: #selector(headerChevronTapped), for: .touchUpInside)
        collapse.widthAnchor.constraint(equalToConstant: 28).isActive = true
        collapse.heightAnchor.constraint(equalToConstant: 22).isActive = true
        row.addArrangedSubview(collapse)

        contentStack.addArrangedSubview(row)
    }

    private func renderChrome() {
        let globe = makeChromeKey("🌐", action: #selector(advanceTapped), width: 36)
        chromeBar.addArrangedSubview(globe)

        let num = makeChromeKey("123", action: #selector(numbersHintTapped), width: 40)
        chromeBar.addArrangedSubview(num)

        let space = makeChromeKey("空格", action: #selector(spaceTapped))
        space.setContentHuggingPriority(.defaultLow, for: .horizontal)
        chromeBar.addArrangedSubview(space)

        let back = makeChromeKey("⌫", action: #selector(backspaceTapped), width: 40)
        chromeBar.addArrangedSubview(back)

        let ret = makePrimaryChromeKey("↵", action: #selector(returnTapped), width: 44)
        chromeBar.addArrangedSubview(ret)
    }

    // MARK: - Phase views

    private func renderIdle() {
        if let gate = authGateMessage() {
            let label = makeLabel(gate, size: 13, weight: .medium, color: bodyText)
            label.textAlignment = .center
            contentStack.addArrangedSubview(label)
            contentStack.addArrangedSubview(makePrimaryButton("打开 Alfred", action: #selector(openAppHome)))
            if let banner = statusBanner {
                contentStack.addArrangedSubview(makeLabel(banner, size: 11, color: mutedText))
            }
            return
        }

        contentStack.addArrangedSubview(makeMascotView(height: 40))

        let title = makeLabel("检测到微信聊天", size: 15, weight: .semibold, color: bodyText)
        title.textAlignment = .center
        contentStack.addArrangedSubview(title)

        let subtitleText: String
        if let n = clipboardHintCount, n > 0 {
            subtitleText = "已复制 \(n) 条消息"
        } else if clipboardHintCount == 0 {
            // Confident clipboard text exists but message boundaries unclear.
            subtitleText = "已检测到剪贴板内容"
        } else {
            subtitleText = "复制微信聊天后即可导入"
        }
        let subtitle = makeLabel(subtitleText, size: 12, weight: .medium, color: mutedText)
        subtitle.textAlignment = .center
        contentStack.addArrangedSubview(subtitle)

        // One compact feature line instead of three stacked bullets.
        let features = makeLabel("理解上下文 · 找重点 · 生成回复", size: 11, weight: .regular, color: mutedText)
        features.textAlignment = .center
        contentStack.addArrangedSubview(features)

        if let banner = statusBanner {
            contentStack.addArrangedSubview(makeLabel(banner, size: 11, color: mutedText))
        }

        contentStack.addArrangedSubview(makePrimaryButton("导入所选聊天", action: #selector(importTapped)))
    }

    private func renderImporting() {
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.color = accent
        spinner.startAnimating()
        contentStack.addArrangedSubview(spinner)

        let title = makeLabel("正在导入聊天…", size: 14, weight: .medium, color: bodyText)
        title.textAlignment = .center
        contentStack.addArrangedSubview(title)
    }

    private func renderGenerating() {
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.color = accent
        spinner.startAnimating()
        contentStack.addArrangedSubview(spinner)

        let title = makeLabel("Alfred 正在理解对话", size: 14, weight: .semibold, color: bodyText)
        title.textAlignment = .center
        contentStack.addArrangedSubview(title)

        let list = UIStackView()
        list.axis = .vertical
        list.spacing = 4
        list.isLayoutMarginsRelativeArrangement = true
        list.layoutMargins = UIEdgeInsets(top: 2, left: 4, bottom: 2, right: 4)

        for (idx, text) in generatingLabels.enumerated() {
            let done = idx < generatingStep || (generatingComplete && idx <= generatingStep)
            let row = UIStackView()
            row.axis = .horizontal
            row.spacing = 6
            row.alignment = .center

            let iconName = done ? "checkmark.circle.fill" : "circle"
            let icon = UIImageView(image: UIImage(systemName: iconName))
            icon.tintColor = done ? accent : mutedText.withAlphaComponent(0.45)
            icon.widthAnchor.constraint(equalToConstant: 14).isActive = true
            icon.heightAnchor.constraint(equalToConstant: 14).isActive = true
            row.addArrangedSubview(icon)

            let label = makeLabel(
                text,
                size: 12,
                weight: done ? .medium : .regular,
                color: done ? bodyText : mutedText
            )
            row.addArrangedSubview(label)
            list.addArrangedSubview(row)
        }
        contentStack.addArrangedSubview(list)
    }

    private func renderContextInsight() {
        let titleRow = UIStackView()
        titleRow.axis = .horizontal
        titleRow.spacing = 4
        titleRow.alignment = .center
        titleRow.addArrangedSubview(makeLabel("Alfred 理解", size: 14, weight: .semibold, color: bodyText))
        let heart = UIImageView(image: UIImage(systemName: "heart.fill"))
        heart.tintColor = accent
        heart.widthAnchor.constraint(equalToConstant: 12).isActive = true
        heart.heightAnchor.constraint(equalToConstant: 12).isActive = true
        titleRow.addArrangedSubview(heart)
        let spacer = UIView()
        titleRow.addArrangedSubview(spacer)
        contentStack.addArrangedSubview(titleRow)

        let body = makeLabel(
            insight.isEmpty ? "对方似乎想继续聊，你的回应会让对方感到安心。" : insight,
            size: 12,
            weight: .regular,
            color: bodyText
        )
        body.numberOfLines = 3
        contentStack.addArrangedSubview(body)

        contentStack.addArrangedSubview(
            makeLabel(
                "重点参考了这些消息（已选 \(selectedMessageIds.count) 条）",
                size: 11,
                weight: .semibold,
                color: mutedText
            )
        )

        let evidence = evidenceMessages(limit: 8)
        if evidence.isEmpty {
            contentStack.addArrangedSubview(
                makeLabel("暂无可用消息，请重新导入", size: 11, color: mutedText)
            )
        } else {
            for msg in evidence {
                contentStack.addArrangedSubview(makeEvidenceBubble(msg))
            }
        }

        contentStack.addArrangedSubview(
            makeSoftPrimaryButton("下一步：生成回复", action: #selector(continueFromInsight))
        )
    }

    private func renderReplyReady() {
        let titleRow = UIStackView()
        titleRow.axis = .horizontal
        titleRow.spacing = 4
        titleRow.alignment = .center
        titleRow.addArrangedSubview(makeLabel("推荐回复", size: 14, weight: .semibold, color: bodyText))
        let bot = UIImageView(image: UIImage(systemName: "face.smiling"))
        bot.tintColor = accent
        bot.widthAnchor.constraint(equalToConstant: 14).isActive = true
        bot.heightAnchor.constraint(equalToConstant: 14).isActive = true
        titleRow.addArrangedSubview(bot)
        let spacer = UIView()
        titleRow.addArrangedSubview(spacer)
        if replies.count > 1 {
            titleRow.addArrangedSubview(makeGhostButton("换一个", action: #selector(cycleReply)))
        }
        contentStack.addArrangedSubview(titleRow)

        let reply = currentReply()?.body ?? "（暂无建议）"
        contentStack.addArrangedSubview(makeReplyBubble(reply))

        let actionsRow = UIStackView()
        actionsRow.axis = .horizontal
        actionsRow.spacing = 8
        actionsRow.distribution = .fillEqually
        actionsRow.addArrangedSubview(makeSecondaryButton("编辑", action: #selector(enterEditing), symbol: "pencil"))
        actionsRow.addArrangedSubview(makePrimaryButton("插入微信", action: #selector(insertCurrentReply), symbol: "square.and.arrow.down"))
        contentStack.addArrangedSubview(actionsRow)

        if let banner = statusBanner {
            contentStack.addArrangedSubview(makeLabel(banner, size: 11, color: mutedText))
        }
    }

    private func renderEditing() {
        let titleRow = UIStackView()
        titleRow.axis = .horizontal
        titleRow.spacing = 4
        titleRow.alignment = .center
        titleRow.addArrangedSubview(makeLabel("编辑回复", size: 14, weight: .semibold, color: bodyText))
        let pencil = UIImageView(image: UIImage(systemName: "pencil"))
        pencil.tintColor = accent
        pencil.widthAnchor.constraint(equalToConstant: 12).isActive = true
        pencil.heightAnchor.constraint(equalToConstant: 12).isActive = true
        titleRow.addArrangedSubview(pencil)
        let spacer = UIView()
        titleRow.addArrangedSubview(spacer)
        contentStack.addArrangedSubview(titleRow)

        let wrap = UIView()
        wrap.backgroundColor = panel
        wrap.layer.cornerRadius = 10
        wrap.layer.borderWidth = 1
        wrap.layer.borderColor = UIColor(white: 0.75, alpha: 0.55).cgColor

        let tv = UITextView()
        tv.font = .systemFont(ofSize: 13)
        tv.textColor = bodyText
        tv.text = currentReply()?.body ?? ""
        tv.backgroundColor = .clear
        tv.textContainerInset = UIEdgeInsets(top: 6, left: 4, bottom: 6, right: 4)
        tv.translatesAutoresizingMaskIntoConstraints = false
        tv.delegate = self
        // Empty inputView prevents iOS from swapping away our custom keyboard
        // when the TextView becomes first responder inside the extension.
        tv.inputView = UIView()
        tv.isEditable = true
        tv.isSelectable = true
        tv.isScrollEnabled = true
        editTextView = tv
        wrap.addSubview(tv)

        let counter = makeLabel(charCountText(for: tv.text), size: 10, color: mutedText)
        counter.textAlignment = .right
        counter.translatesAutoresizingMaskIntoConstraints = false
        charCountLabel = counter
        wrap.addSubview(counter)

        NSLayoutConstraint.activate([
            tv.leadingAnchor.constraint(equalTo: wrap.leadingAnchor, constant: 4),
            tv.trailingAnchor.constraint(equalTo: wrap.trailingAnchor, constant: -4),
            tv.topAnchor.constraint(equalTo: wrap.topAnchor, constant: 2),
            tv.heightAnchor.constraint(equalToConstant: 56),
            counter.trailingAnchor.constraint(equalTo: wrap.trailingAnchor, constant: -8),
            counter.topAnchor.constraint(equalTo: tv.bottomAnchor, constant: 0),
            counter.bottomAnchor.constraint(equalTo: wrap.bottomAnchor, constant: -4),
        ])
        contentStack.addArrangedSubview(wrap)

        let tones = UIStackView()
        tones.axis = .horizontal
        tones.spacing = 6
        tones.distribution = .fillEqually
        tones.addArrangedSubview(makeChipButton("更短", symbol: "scissors", action: #selector(rewriteBrief)))
        tones.addArrangedSubview(makeChipButton("更温柔", symbol: "heart", action: #selector(rewriteCaring)))
        tones.addArrangedSubview(makeChipButton("更坚定", symbol: "seal", action: #selector(rewriteDirect)))
        contentStack.addArrangedSubview(tones)

        contentStack.addArrangedSubview(makePrimaryButton("插入微信", action: #selector(insertEditedReply)))

        // Focus after the next layout pass so the TextView is in the hierarchy.
        DispatchQueue.main.async { [weak self] in
            self?.editTextView?.becomeFirstResponder()
        }
    }

    private func renderSuccess() {
        let checkWrap = UIView()
        let check = UIImageView(image: UIImage(systemName: "checkmark.circle.fill"))
        check.tintColor = accent
        check.translatesAutoresizingMaskIntoConstraints = false
        check.contentMode = .scaleAspectFit
        checkWrap.addSubview(check)
        NSLayoutConstraint.activate([
            check.centerXAnchor.constraint(equalTo: checkWrap.centerXAnchor),
            check.topAnchor.constraint(equalTo: checkWrap.topAnchor),
            check.bottomAnchor.constraint(equalTo: checkWrap.bottomAnchor),
            check.widthAnchor.constraint(equalToConstant: 36),
            check.heightAnchor.constraint(equalToConstant: 36),
            checkWrap.heightAnchor.constraint(equalToConstant: 40),
        ])
        contentStack.addArrangedSubview(checkWrap)

        let title = makeLabel("已插入微信", size: 15, weight: .semibold, color: bodyText)
        title.textAlignment = .center
        contentStack.addArrangedSubview(title)

        let count = actions.count
        if count > 0 {
            let follow = makeLabel(
                "Alfred 还发现了 \(count) 个跟进行动",
                size: 12,
                color: mutedText
            )
            follow.textAlignment = .center
            contentStack.addArrangedSubview(follow)

            for action in actions.prefix(2) {
                contentStack.addArrangedSubview(makeSuccessActionCard(action))
            }
        } else {
            let none = makeLabel("没有更多跟进事项", size: 12, color: mutedText)
            none.textAlignment = .center
            contentStack.addArrangedSubview(none)
        }

        if let banner = statusBanner {
            contentStack.addArrangedSubview(makeLabel(banner, size: 11, color: mutedText))
        }

        let done = UIButton(type: .system)
        done.setTitle("完成", for: .normal)
        done.titleLabel?.font = .systemFont(ofSize: 14, weight: .medium)
        done.setTitleColor(accent, for: .normal)
        done.addTarget(self, action: #selector(resetToIdle), for: .touchUpInside)
        contentStack.addArrangedSubview(done)
    }

    private func renderError(_ message: String) {
        let label = makeLabel(message, size: 13, weight: .medium, color: UIColor.systemOrange)
        label.textAlignment = .center
        contentStack.addArrangedSubview(label)
        contentStack.addArrangedSubview(makePrimaryButton("重试", action: #selector(resetToIdle)))
    }

    // MARK: - Auth gate

    /// Exact banner strings shown when auth/FA is incomplete (also used to
    /// recover from `.error` after the user flips Full Access in Settings).
    private static let authGateCopy: Set<String> = [
        "需要允许完全访问",
        "未发现共享容器",
        "主 App 尚未同步",
    ]

    /// Live checks — never cache `hasFullAccess`; iOS updates it after Settings.
    private func authGateMessage() -> String? {
        if !hasFullAccess {
            return "需要允许完全访问"
        }
        if !AlfredAppGroup.isAvailable {
            return "未发现共享容器"
        }
        if AlfredAppGroup.authToken() == nil {
            return "主 App 尚未同步"
        }
        return nil
    }

    private func mapError(_ error: Error) -> String {
        if let api = error as? AlfredKeyboardAPI.APIError {
            return api.errorDescription ?? "出错了"
        }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            return "网络不可用"
        }
        return error.localizedDescription
    }

    // MARK: - Actions

    @objc private func resetToIdle() {
        stopGeneratingProgress()
        phase = .idle
        statusBanner = nil
        clipboardHintCount = estimateClipboardMessageCount()
        render()
    }

    @objc private func advanceTapped() { advanceToNextInputMode() }
    @objc private func spaceTapped() { insertIntoActiveField(" ") }
    @objc private func backspaceTapped() { deleteFromActiveField() }
    @objc private func returnTapped() { insertIntoActiveField("\n") }
    @objc private func numbersHintTapped() { insertIntoActiveField("123") }

    /// While editing a draft, chrome keys target the TextView — not WeChat.
    private func insertIntoActiveField(_ text: String) {
        if case .editing = phase, let tv = editTextView, tv.isFirstResponder {
            let selected = tv.selectedRange
            let ns = (tv.text as NSString?) ?? ""
            var updated = ns.replacingCharacters(in: selected, with: text)
            if updated.count > maxEditChars {
                updated = String(updated.prefix(maxEditChars))
            }
            tv.text = updated
            let cursor = min(selected.location + (text as NSString).length, (updated as NSString).length)
            tv.selectedRange = NSRange(location: cursor, length: 0)
            updateCharCount()
            return
        }
        textDocumentProxy.insertText(text)
    }

    private func deleteFromActiveField() {
        if case .editing = phase, let tv = editTextView, tv.isFirstResponder {
            let selected = tv.selectedRange
            let ns = (tv.text as NSString?) ?? ""
            if selected.length > 0 {
                tv.text = ns.replacingCharacters(in: selected, with: "")
                tv.selectedRange = NSRange(location: selected.location, length: 0)
            } else if selected.location > 0 {
                let range = NSRange(location: selected.location - 1, length: 1)
                tv.text = ns.replacingCharacters(in: range, with: "")
                tv.selectedRange = NSRange(location: selected.location - 1, length: 0)
            }
            updateCharCount()
            return
        }
        textDocumentProxy.deleteBackward()
    }

    @objc private func headerChevronTapped() {
        if conversationId != nil {
            expandTapped()
        } else {
            advanceToNextInputMode()
        }
    }

    @objc private func openAppHome() {
        openContainingApp(urlString: "albert://")
    }

    @objc private func importTapped() {
        if let gate = authGateMessage() {
            phase = .error(gate)
            render()
            return
        }
        guard let text = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty
        else {
            phase = .error("剪贴板是空的 — 先在微信多选复制")
            render()
            return
        }
        phase = .importing
        render()
        Task { await runParse(text: text) }
    }

    @MainActor
    private func runParse(text: String) async {
        do {
            let parsed = try await AlfredKeyboardAPI.parse(text: text)
            conversationId = parsed.id
            parsedMessages = parsed.messages

            // Product: 复制 N 条 → 读取全部 → 再回复. Never cap to top-K.
            // Prefer server non-noise selection; if under-selected, take all weight>=1.
            var selected = Set(parsed.messages.filter(\.is_selected).map(\.id))
            let nonNoise = parsed.messages.filter { ($0.weight ?? 1.0) >= 1.0 }
            if selected.isEmpty {
                selected = Set((nonNoise.isEmpty ? parsed.messages : nonNoise).map(\.id))
            } else if selected.count < parsed.messages.count,
                      selected.count < max(2, (parsed.messages.count + 1) / 2)
            {
                // Parser/LLM under-selected (e.g. only 1 of 10); restore full thread.
                selected = Set((nonNoise.isEmpty ? parsed.messages : nonNoise).map(\.id))
            }
            selectedMessageIds = selected

            let messages: [[String: Any]] = parsed.messages.map { m in
                [
                    "id": m.id,
                    "sender": m.sender,
                    "content": m.content,
                    "role": "unknown",
                    "is_selected": selected.contains(m.id),
                    "weight": m.weight ?? 1.0,
                    "timestamp": NSNull(),
                ]
            }
            conversationJSON = [
                "id": parsed.id,
                "source": "wechat",
                "participants": [],
                "messages": messages,
                "imported_at": ISO8601DateFormatter().string(from: Date()),
            ]
            insight = buildHeuristicInsight()
            phase = .contextInsight
            render()
        } catch {
            phase = .error(mapError(error))
            render()
        }
    }

    @objc private func continueFromInsight() {
        phase = .generating
        generatingStep = 0
        generatingComplete = false
        render()
        startGeneratingProgress()
        Task { await runAnalyze() }
    }

    @MainActor
    private func runAnalyze(tones: [String]? = nil, returnToEditing: Bool = false) async {
        guard var conversation = conversationJSON else {
            stopGeneratingProgress()
            phase = .error("会话丢失，请重新导入")
            render()
            return
        }
        if var messages = conversation["messages"] as? [[String: Any]] {
            messages = messages.map { m in
                var copy = m
                if let id = m["id"] as? String {
                    copy["is_selected"] = selectedMessageIds.contains(id)
                }
                return copy
            }
            conversation["messages"] = messages
            conversationJSON = conversation
        }
        do {
            let analyzed = try await AlfredKeyboardAPI.analyze(
                conversation: conversation,
                goal: "custom",
                tones: tones
            )
            replies = analyzed.reply_suggestions
            replyIndex = 0
            actions = analyzed.actions
            let serverInsight = analyzed.insight?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !serverInsight.isEmpty {
                insight = serverInsight
            } else if insight.isEmpty {
                if let first = actions.first?.title, !first.isEmpty {
                    insight = first
                } else {
                    insight = "已分析对话，可插入回复"
                }
            }
            finishGeneratingProgress()
            if returnToEditing {
                phase = .editing
            } else {
                phase = .replyReady
            }
            render()
            if returnToEditing {
                editTextView?.text = currentReply()?.body
                updateCharCount()
            }
        } catch {
            stopGeneratingProgress()
            if returnToEditing, let tone = tones?.first {
                let draft = currentReply()?.body ?? ""
                if !draft.isEmpty {
                    replies = [AlfredKeyboardAPI.Reply(tone: tone, body: localRewrite(draft, tone: tone))]
                    replyIndex = 0
                    phase = .editing
                    render()
                    editTextView?.text = currentReply()?.body
                    updateCharCount()
                    return
                }
            }
            phase = .error(mapError(error))
            render()
        }
    }

    @objc private func cycleReply() {
        guard !replies.isEmpty else { return }
        replyIndex = (replyIndex + 1) % replies.count
        render()
    }

    @objc private func enterEditing() {
        phase = .editing
        render()
    }

    @objc private func insertCurrentReply() {
        guard let body = currentReply()?.body else { return }
        textDocumentProxy.insertText(body)
        phase = .success
        statusBanner = nil
        render()
    }

    @objc private func insertEditedReply() {
        var text = editTextView?.text ?? currentReply()?.body ?? ""
        if text.count > maxEditChars {
            text = String(text.prefix(maxEditChars))
        }
        guard !text.isEmpty else { return }
        textDocumentProxy.insertText(text)
        if !replies.isEmpty {
            let tone = replies[replyIndex].tone
            replies[replyIndex] = AlfredKeyboardAPI.Reply(tone: tone, body: text)
        }
        phase = .success
        statusBanner = nil
        render()
    }

    @objc private func rewriteBrief() { Task { await rewrite(tone: "brief") } }
    @objc private func rewriteCaring() { Task { await rewrite(tone: "caring") } }
    @objc private func rewriteDirect() { Task { await rewrite(tone: "natural") } }

    @MainActor
    private func rewrite(tone: String) async {
        // Persist draft before leaving editing UI (text view is cleared on re-render).
        if let draft = editTextView?.text {
            if replies.isEmpty {
                replies = [AlfredKeyboardAPI.Reply(tone: tone, body: draft)]
                replyIndex = 0
            } else {
                let t = replies[replyIndex].tone
                replies[replyIndex] = AlfredKeyboardAPI.Reply(tone: t, body: draft)
            }
        }
        phase = .generating
        generatingStep = 0
        generatingComplete = false
        render()
        startGeneratingProgress()
        await runAnalyze(tones: [tone], returnToEditing: true)
        if case .editing = phase, let idx = replies.firstIndex(where: { $0.tone == tone }) {
            replyIndex = idx
            editTextView?.text = currentReply()?.body
            updateCharCount()
        }
    }

    private func localRewrite(_ text: String, tone: String) -> String {
        switch tone {
        case "brief":
            let trimmed = text.replacingOccurrences(of: "\n", with: " ")
            return String(trimmed.prefix(40))
        case "caring":
            return text.hasSuffix("～") || text.hasSuffix("~") ? text : text + "～"
        default:
            return text
        }
    }

    @objc private func expandTapped() {
        writeHandoff()
        let id = conversationId ?? "pending"
        openContainingApp(urlString: "albert://conversation/\(id)")
    }

    private func writeHandoff() {
        var payload: [String: Any] = [:]
        if let conversationId { payload["conversation_id"] = conversationId }
        if let conversationJSON { payload["conversation"] = conversationJSON }
        payload["insight"] = insight
        payload["replies"] = replies.map { ["tone": $0.tone, "body": $0.body] }
        payload["actions"] = actions.map { actionDict($0) }
        AlfredAppGroup.setPendingHandoff(payload)
    }

    private func actionDict(_ action: AlfredKeyboardAPI.Action) -> [String: Any] {
        [
            "id": action.id,
            "type": action.type,
            "title": action.title,
            "due_date": action.due_date as Any,
            "start": action.start as Any,
            "end": action.end as Any,
            "suggested_time": action.suggested_time as Any,
            "confidence": action.confidence,
            "evidence": action.evidence,
            "evidence_message_ids": action.evidence_message_ids,
            "tier": action.tier,
            "status": action.status,
        ]
    }

    /// Open the main Alfred app via custom scheme `albert://…`.
    ///
    /// Host apps (especially WeChat) often block `extensionContext.open` and the
    /// responder-chain `openURL:` from keyboard extensions. Always copy the link
    /// as a fallback and surface a banner so the user can open Alfred manually.
    private func openContainingApp(urlString: String) {
        guard let url = URL(string: urlString) else { return }

        // Clipboard fallback — works even when the host blocks openURL.
        if hasFullAccess {
            UIPasteboard.general.string = urlString
        }

        var openedViaResponder = false
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: selector) {
                r.perform(selector, with: url)
                openedViaResponder = true
                break
            }
            responder = r.next
        }

        if !openedViaResponder {
            extensionContext?.open(url) { [weak self] success in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if success {
                        self.statusBanner = nil
                    } else {
                        self.statusBanner = "已复制链接，请打开 Alfred"
                        self.render()
                    }
                }
            }
        } else {
            // Responder openURL gives no completion — assume host may still block
            // (WeChat). Show copy hint so the tap is never a silent no-op.
            statusBanner = "已复制链接，请打开 Alfred"
            render()
        }
    }

    @MainActor
    private func confirm(_ action: AlfredKeyboardAPI.Action) async {
        if action.type == "calendar_event", action.start != nil {
            writeHandoff()
            openContainingApp(urlString: "albert://conversation/\(conversationId ?? "pending")")
            statusBanner = "请在 App 中确认日程"
            render()
            return
        }
        do {
            let res = try await AlfredKeyboardAPI.confirm(action: action, conversationId: conversationId)
            AlfredAppGroup.enqueueConfirmedAction([
                "kind": res.kind,
                "id": res.id,
                "title": res.title,
                "evidence": res.evidence as Any,
                "remind_at": res.remind_at as Any,
                "confirmed_at": ISO8601DateFormatter().string(from: Date()),
            ])
            actions.removeAll { $0.id == action.id }
            statusBanner = res.remind_at != nil
                ? "已加入 Alfred · 回 App 后会设本地提醒"
                : "已加入 Alfred"
            render()
        } catch {
            statusBanner = mapError(error)
            render()
        }
    }

    private func currentReply() -> AlfredKeyboardAPI.Reply? {
        guard replies.indices.contains(replyIndex) else { return nil }
        return replies[replyIndex]
    }

    // MARK: - Generating progress

    private func startGeneratingProgress() {
        generatingTimer?.invalidate()
        generatingStep = 0
        generatingComplete = false
        generatingTimer = Timer.scheduledTimer(withTimeInterval: 0.55, repeats: true) { [weak self] _ in
            guard let self else { return }
            DispatchQueue.main.async {
                guard case .generating = self.phase else { return }
                // Leave the last item unchecked until the API finishes.
                if self.generatingStep < self.generatingLabels.count - 1 {
                    self.generatingStep += 1
                    self.render()
                }
            }
        }
    }

    private func finishGeneratingProgress() {
        generatingComplete = true
        generatingStep = generatingLabels.count
        generatingTimer?.invalidate()
        generatingTimer = nil
    }

    private func stopGeneratingProgress() {
        generatingTimer?.invalidate()
        generatingTimer = nil
        generatingComplete = false
        generatingStep = 0
    }

    // MARK: - Heuristics / clipboard

    private func estimateClipboardMessageCount() -> Int? {
        guard hasFullAccess,
              let text = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty
        else { return nil }

        // Prefer blank-line WeChat blocks (sender + body per block).
        let blocks = text
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if blocks.count >= 2 {
            let senderish = blocks.filter { block in
                let first = block
                    .components(separatedBy: .newlines)
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .first { !$0.isEmpty } ?? ""
                return isProbableSenderLine(first)
            }.count
            if senderish >= max(2, blocks.count / 2) {
                return senderish
            }
        }

        // Dense alternating sender/content (no blank lines) — same idea as backend.
        let lines = text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let dense = countDenseWeChatMessages(lines)
        if dense >= 2 { return dense }

        // Colon export: "Name：message"
        let colonHits = lines.filter { line in
            guard let idx = line.firstIndex(where: { $0 == "：" || $0 == ":" }) else { return false }
            let name = String(line[..<idx]).trimmingCharacters(in: .whitespacesAndNewlines)
            return isProbableSenderLine(name)
        }.count
        if colonHits >= 2 { return colonHits }

        // Clipboard has text but we can't count messages confidently — never invent N.
        return 0
    }

    private func countDenseWeChatMessages(_ lines: [String]) -> Int {
        var count = 0
        var i = 0
        while i < lines.count {
            let line = lines[i]
            if isDateSeparator(line) || isSystemOrMediaLine(line) {
                i += 1
                continue
            }
            guard isProbableSenderLine(stripSenderTimestamp(line)) else {
                i += 1
                continue
            }
            i += 1
            var skippedMedia = false
            while i < lines.count && isSystemOrMediaLine(lines[i]) {
                skippedMedia = true
                i += 1
            }
            if i >= lines.count { break }
            if isDateSeparator(lines[i]) {
                i += 1
                continue
            }
            // Media-only bubble: name + [图片] + next name.
            if skippedMedia && isProbableSenderLine(stripSenderTimestamp(lines[i])) {
                continue
            }
            // First content line is always content (even if sender-ish).
            i += 1
            count += 1
            while i < lines.count {
                let nxt = lines[i]
                if isDateSeparator(nxt) {
                    i += 1
                    break
                }
                if isProbableSenderLine(stripSenderTimestamp(nxt)) { break }
                if isSystemOrMediaLine(nxt) {
                    i += 1
                    continue
                }
                i += 1
            }
        }
        return count
    }

    /// Strip optional "HH:MM" / "昨天 HH:MM" suffix for sender checks.
    private func stripSenderTimestamp(_ line: String) -> String {
        if let range = line.range(
            of: #"\s+(\d{1,2}:\d{2}|昨天\s*\d{1,2}:\d{2}|今天\s*\d{1,2}:\d{2})$"#,
            options: .regularExpression
        ) {
            return String(line[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return line
    }

    private func isProbableSenderLine(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 40 else { return false }
        if trimmed.rangeOfCharacter(from: CharacterSet(charactersIn: "。！？.!?，,")) != nil {
            return false
        }
        if trimmed.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil {
            return false
        }
        if isDateSeparator(trimmed) || isSystemOrMediaLine(trimmed) { return false }
        return true
    }

    private func isDateSeparator(_ line: String) -> Bool {
        line.range(
            of: #"^[\-—–]+\s*(昨天|今天|星期[一二三四五六日天]|\d{1,2}月\d{1,2}日)"#,
            options: .regularExpression
        ) != nil
    }

    private func isSystemOrMediaLine(_ line: String) -> Bool {
        let patterns = [
            #"^以上是历史消息$"#,
            #"^.*撤回了一条消息$"#,
            #"^.*拍了拍.*$"#,
            #"^\[(图片|视频|语音|文件|动画表情|贴纸)\]$"#,
        ]
        return patterns.contains { line.range(of: $0, options: .regularExpression) != nil }
    }

    private func buildHeuristicInsight() -> String {
        let selected = parsedMessages.filter { selectedMessageIds.contains($0.id) }
        let blob = selected.map(\.content).joined(separator: " ")
        if blob.contains("消化") || blob.contains("难受") || blob.contains("难过") || blob.contains("委屈") {
            return "对方还在消化昨天的事情，想继续聊，你的回应会让对方感到安心。"
        }
        if blob.contains("忙") || blob.contains("稍后") || blob.contains("晚点") {
            return "对方节奏有点紧，温柔地接一下，给对方留一点空间会更好。"
        }
        if blob.contains("谢谢") || blob.contains("感谢") {
            return "对方在表达感谢，简短真诚的回应就能接住这份善意。"
        }
        if selected.count >= 2 {
            return "对话里有几处值得回应的重点，先接住情绪，再轻轻推进会更自然。"
        }
        return "对方似乎想继续聊，你的回应会让对方感到安心。"
    }

    private func evidenceMessages(limit: Int) -> [AlfredKeyboardAPI.Message] {
        // Chronological thread order (not weight-ranked) so UI matches full-context analyze.
        let selected = parsedMessages.filter { selectedMessageIds.contains($0.id) }
        if selected.isEmpty {
            return Array(parsedMessages.suffix(limit))
        }
        if selected.count > limit {
            return Array(selected.suffix(limit))
        }
        return selected
    }

    private func formatSuggestedTime(_ action: AlfredKeyboardAPI.Action) -> String? {
        if let t = action.suggested_time, !t.isEmpty {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = iso.date(from: t) ?? ISO8601DateFormatter().date(from: t) {
                let fmt = DateFormatter()
                fmt.locale = Locale(identifier: "zh_CN")
                fmt.dateFormat = "HH:mm"
                return fmt.string(from: date)
            }
            if let range = t.range(of: #"\d{1,2}:\d{2}"#, options: .regularExpression) {
                return String(t[range])
            }
            return t
        }
        if let due = action.due_date, !due.isEmpty { return due }
        return nil
    }

    private func charCountText(for text: String?) -> String {
        let n = min(text?.count ?? 0, maxEditChars)
        return "\(n)/\(maxEditChars)"
    }

    private func updateCharCount() {
        charCountLabel?.text = charCountText(for: editTextView?.text)
    }

    // MARK: - UI helpers

    private func makeLabel(
        _ text: String,
        size: CGFloat,
        weight: UIFont.Weight = .regular,
        color: UIColor? = nil
    ) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textColor = color ?? bodyText
        label.numberOfLines = 0
        return label
    }

    private func makeMascotView(height: CGFloat) -> UIView {
        let wrap = UIView()
        let imageView = UIImageView()
        if let img = UIImage(named: "alfred-mascot") {
            imageView.image = img
        } else {
            imageView.image = UIImage(systemName: "face.smiling.inverse")
            imageView.tintColor = accent
        }
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        wrap.addSubview(imageView)
        NSLayoutConstraint.activate([
            imageView.centerXAnchor.constraint(equalTo: wrap.centerXAnchor),
            imageView.topAnchor.constraint(equalTo: wrap.topAnchor),
            imageView.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
            imageView.heightAnchor.constraint(equalToConstant: height),
            imageView.widthAnchor.constraint(equalToConstant: height),
            wrap.heightAnchor.constraint(equalToConstant: height),
        ])
        return wrap
    }

    private func makeEvidenceBubble(_ msg: AlfredKeyboardAPI.Message) -> UIView {
        let card = UIStackView()
        card.axis = .vertical
        card.spacing = 2
        card.isLayoutMarginsRelativeArrangement = true
        card.layoutMargins = UIEdgeInsets(top: 6, left: 8, bottom: 6, right: 8)
        card.backgroundColor = panel
        card.layer.cornerRadius = 8

        let meta = UIStackView()
        meta.axis = .horizontal
        meta.spacing = 4
        meta.alignment = .center

        let check = UIImageView(image: UIImage(systemName: "checkmark.circle.fill"))
        check.tintColor = accent
        check.widthAnchor.constraint(equalToConstant: 12).isActive = true
        check.heightAnchor.constraint(equalToConstant: 12).isActive = true
        meta.addArrangedSubview(check)

        let sender = String(msg.sender.suffix(4))
        meta.addArrangedSubview(makeLabel(sender, size: 10, weight: .medium, color: mutedText))
        let spacer = UIView()
        meta.addArrangedSubview(spacer)
        card.addArrangedSubview(meta)

        let body = makeLabel(msg.content, size: 11, color: bodyText)
        body.numberOfLines = 2
        card.addArrangedSubview(body)
        return card
    }

    private func makeReplyBubble(_ text: String) -> UIView {
        let wrap = UIView()
        wrap.backgroundColor = bubbleFill
        wrap.layer.cornerRadius = 12

        let label = makeLabel(text, size: 13, weight: .medium, color: bodyText)
        label.numberOfLines = 4
        label.translatesAutoresizingMaskIntoConstraints = false
        wrap.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: wrap.leadingAnchor, constant: 10),
            label.trailingAnchor.constraint(equalTo: wrap.trailingAnchor, constant: -10),
            label.topAnchor.constraint(equalTo: wrap.topAnchor, constant: 8),
            label.bottomAnchor.constraint(equalTo: wrap.bottomAnchor, constant: -8),
        ])
        return wrap
    }

    private func makeSuccessActionCard(_ action: AlfredKeyboardAPI.Action) -> UIView {
        let card = UIStackView()
        card.axis = .vertical
        card.spacing = 4
        card.isLayoutMarginsRelativeArrangement = true
        card.layoutMargins = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
        card.backgroundColor = accentSoft
        card.layer.cornerRadius = 10

        let titleRow = UIStackView()
        titleRow.axis = .horizontal
        titleRow.spacing = 4
        titleRow.alignment = .center
        let bell = UIImageView(image: UIImage(systemName: "bell.fill"))
        bell.tintColor = accent
        bell.widthAnchor.constraint(equalToConstant: 12).isActive = true
        bell.heightAnchor.constraint(equalToConstant: 12).isActive = true
        titleRow.addArrangedSubview(bell)
        titleRow.addArrangedSubview(makeLabel(action.title, size: 12, weight: .semibold, color: bodyText))
        card.addArrangedSubview(titleRow)

        if let time = formatSuggestedTime(action) {
            card.addArrangedSubview(
                makeLabel("建议提醒时间: \(time)", size: 11, color: mutedText)
            )
        } else {
            let evidence = makeLabel("「\(action.evidence)」", size: 10, color: mutedText)
            evidence.numberOfLines = 2
            card.addArrangedSubview(evidence)
        }

        let btn = UIButton(type: .system)
        var config = UIButton.Configuration.filled()
        config.title = confirmTitle(action)
        config.baseBackgroundColor = accent
        config.baseForegroundColor = .white
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 5, leading: 8, bottom: 5, trailing: 8)
        btn.configuration = config
        btn.addAction(UIAction { [weak self] _ in
            Task { await self?.confirm(action) }
        }, for: .touchUpInside)
        card.addArrangedSubview(btn)
        return card
    }

    private func confirmTitle(_ action: AlfredKeyboardAPI.Action) -> String {
        switch action.type {
        case "calendar_event": return "添加日历"
        case "follow_up": return "添加提醒"
        default: return "添加提醒"
        }
    }

    private func makePrimaryButton(_ title: String, action: Selector, symbol: String? = nil) -> UIButton {
        var config = UIButton.Configuration.filled()
        config.title = title
        config.baseBackgroundColor = accent
        config.baseForegroundColor = .white
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)
        if let symbol {
            config.image = UIImage(systemName: symbol)
            config.imagePadding = 5
            config.imagePlacement = .leading
        }
        let button = UIButton(configuration: config)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func makeSoftPrimaryButton(_ title: String, action: Selector) -> UIButton {
        var config = UIButton.Configuration.filled()
        config.title = title
        config.baseBackgroundColor = accentSoft
        config.baseForegroundColor = accent
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)
        let button = UIButton(configuration: config)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func makeSecondaryButton(_ title: String, action: Selector, symbol: String? = nil) -> UIButton {
        var config = UIButton.Configuration.gray()
        config.title = title
        config.baseForegroundColor = bodyText
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8)
        if let symbol {
            config.image = UIImage(systemName: symbol)
            config.imagePadding = 5
            config.imagePlacement = .leading
        }
        let button = UIButton(configuration: config)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func makeChipButton(_ title: String, symbol: String, action: Selector) -> UIButton {
        var config = UIButton.Configuration.plain()
        config.title = title
        config.baseForegroundColor = accent
        config.image = UIImage(systemName: symbol)
        config.imagePadding = 3
        config.imagePlacement = .leading
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 5, leading: 6, bottom: 5, trailing: 6)
        config.background.strokeColor = accent.withAlphaComponent(0.35)
        config.background.strokeWidth = 1
        config.background.backgroundColor = .white
        let button = UIButton(configuration: config)
        button.titleLabel?.font = .systemFont(ofSize: 11, weight: .medium)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func makeGhostButton(_ title: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 12, weight: .medium)
        button.setTitleColor(accent, for: .normal)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func makeChromeKey(_ title: String, action: Selector, width: CGFloat? = nil) -> UIButton {
        var config = UIButton.Configuration.gray()
        config.title = title
        config.baseForegroundColor = bodyText
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 6, bottom: 6, trailing: 6)
        let button = UIButton(configuration: config)
        button.addTarget(self, action: action, for: .touchUpInside)
        if let width {
            button.widthAnchor.constraint(equalToConstant: width).isActive = true
        }
        button.heightAnchor.constraint(equalToConstant: 34).isActive = true
        return button
    }

    private func makePrimaryChromeKey(_ title: String, action: Selector, width: CGFloat) -> UIButton {
        var config = UIButton.Configuration.filled()
        config.title = title
        config.baseBackgroundColor = accent
        config.baseForegroundColor = .white
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 6, bottom: 6, trailing: 6)
        let button = UIButton(configuration: config)
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: width).isActive = true
        button.heightAnchor.constraint(equalToConstant: 34).isActive = true
        return button
    }
}

extension KeyboardViewController: UITextViewDelegate {
    func textViewDidChange(_ textView: UITextView) {
        if textView.text.count > maxEditChars {
            textView.text = String(textView.text.prefix(maxEditChars))
        }
        updateCharCount()
    }
}
