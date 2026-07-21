import UIKit

/// Custom keyboard: detect WeChat paste → parse/analyze → insert reply + confirm actions.
final class KeyboardViewController: UIInputViewController {
    private let root = UIStackView()
    private let statusLabel = UILabel()
    private let contentScroll = UIScrollView()
    private let contentStack = UIStackView()

    private var conversationJSON: [String: Any]?
    private var conversationId: String?
    private var replies: [AlfredKeyboardAPI.Reply] = []
    private var actions: [AlfredKeyboardAPI.Action] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.secondarySystemBackground
        setupChrome()
        refreshClipboardBanner()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshClipboardBanner()
    }

    private func setupChrome() {
        root.axis = .vertical
        root.spacing = 8
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            root.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),
            view.heightAnchor.constraint(greaterThanOrEqualToConstant: 260),
        ])

        statusLabel.font = .systemFont(ofSize: 13, weight: .medium)
        statusLabel.numberOfLines = 2
        statusLabel.textColor = .label
        root.addArrangedSubview(statusLabel)

        let toolbar = UIStackView()
        toolbar.axis = .horizontal
        toolbar.spacing = 8
        toolbar.distribution = .fillEqually
        toolbar.addArrangedSubview(makeButton("导入对话", action: #selector(importTapped)))
        toolbar.addArrangedSubview(makeButton("下一键盘", action: #selector(advanceTapped)))
        root.addArrangedSubview(toolbar)

        contentScroll.translatesAutoresizingMaskIntoConstraints = false
        contentStack.axis = .vertical
        contentStack.spacing = 8
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        contentScroll.addSubview(contentStack)
        root.addArrangedSubview(contentScroll)
        NSLayoutConstraint.activate([
            contentScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 160),
            contentStack.leadingAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.leadingAnchor),
            contentStack.trailingAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.trailingAnchor),
            contentStack.topAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.topAnchor),
            contentStack.bottomAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.bottomAnchor),
            contentStack.widthAnchor.constraint(equalTo: contentScroll.frameLayoutGuide.widthAnchor),
        ])
    }

    private func makeButton(_ title: String, action: Selector) -> UIButton {
        var config = UIButton.Configuration.filled()
        config.title = title
        config.baseBackgroundColor = UIColor(red: 0.23, green: 0.36, blue: 0.66, alpha: 1)
        config.baseForegroundColor = .white
        config.cornerStyle = .medium
        let button = UIButton(configuration: config)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func refreshClipboardBanner() {
        let text = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let lines = text.split(whereSeparator: \.isNewline).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        if looksLikeChat(text) {
            statusLabel.text = "检测到 \(max(lines.count / 2, 1)) 条聊天消息"
        } else if AlfredAppGroup.authToken() == nil {
            statusLabel.text = "请先在 Alfred App 登录，并开启键盘完全访问"
        } else {
            statusLabel.text = "复制微信多选消息后点「导入对话」"
        }
    }

    private func looksLikeChat(_ text: String) -> Bool {
        let blocks = text.components(separatedBy: "\n\n").filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return blocks.count >= 2 || text.contains("\n")
    }

    @objc private func advanceTapped() {
        advanceToNextInputMode()
    }

    @objc private func importTapped() {
        guard let text = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty
        else {
            statusLabel.text = "剪贴板是空的"
            return
        }
        statusLabel.text = "正在解析…"
        clearContent()
        Task { await runImport(text: text) }
    }

    @MainActor
    private func runImport(text: String) async {
        do {
            let parsed = try await AlfredKeyboardAPI.parse(text: text)
            conversationId = parsed.id
            // Rebuild a JSON object the analyze endpoint expects.
            let messages: [[String: Any]] = parsed.messages.map { m in
                [
                    "id": m.id,
                    "sender": m.sender,
                    "content": m.content,
                    "role": "unknown",
                    "is_selected": m.is_selected,
                    "weight": m.weight ?? 1.0,
                    "timestamp": NSNull(),
                ]
            }
            let conversation: [String: Any] = [
                "id": parsed.id,
                "source": "wechat",
                "participants": [],
                "messages": messages,
                "imported_at": ISO8601DateFormatter().string(from: Date()),
            ]
            conversationJSON = conversation
            statusLabel.text = "正在生成回复与行动…"
            let analyzed = try await AlfredKeyboardAPI.analyze(conversation: conversation, goal: "custom")
            replies = analyzed.reply_suggestions
            actions = analyzed.actions
            renderResults()
            statusLabel.text = "建议回复 · \(replies.count) · 行动 \(actions.count)"
        } catch AlfredKeyboardAPI.APIError.notSignedIn {
            statusLabel.text = "未登录 — 打开 Alfred App 登录后再试"
        } catch {
            statusLabel.text = "出错了：\(error.localizedDescription)"
        }
    }

    private func clearContent() {
        contentStack.arrangedSubviews.forEach {
            contentStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
    }

    @MainActor
    private func renderResults() {
        clearContent()

        for action in actions.prefix(3) {
            let card = makeActionCard(action)
            contentStack.addArrangedSubview(card)
        }

        let replyTitle = UILabel()
        replyTitle.text = "建议回复"
        replyTitle.font = .systemFont(ofSize: 12, weight: .semibold)
        replyTitle.textColor = .secondaryLabel
        contentStack.addArrangedSubview(replyTitle)

        for reply in replies {
            let card = UIStackView()
            card.axis = .vertical
            card.spacing = 4
            card.isLayoutMarginsRelativeArrangement = true
            card.layoutMargins = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
            card.backgroundColor = .systemBackground
            card.layer.cornerRadius = 10

            let tone = UILabel()
            tone.text = toneLabel(reply.tone)
            tone.font = .systemFont(ofSize: 11, weight: .semibold)
            tone.textColor = .secondaryLabel
            let body = UILabel()
            body.text = reply.body
            body.font = .systemFont(ofSize: 14)
            body.numberOfLines = 4
            card.addArrangedSubview(tone)
            card.addArrangedSubview(body)

            let insert = UIButton(type: .system)
            insert.setTitle("插入回复", for: .normal)
            insert.tag = replies.firstIndex(where: { $0.body == reply.body }) ?? 0
            insert.addTarget(self, action: #selector(insertReplyTapped(_:)), for: .touchUpInside)
            card.addArrangedSubview(insert)
            contentStack.addArrangedSubview(card)
        }
    }

    private func makeActionCard(_ action: AlfredKeyboardAPI.Action) -> UIView {
        let card = UIStackView()
        card.axis = .vertical
        card.spacing = 6
        card.isLayoutMarginsRelativeArrangement = true
        card.layoutMargins = UIEdgeInsets(top: 10, left: 10, bottom: 10, right: 10)
        card.backgroundColor = UIColor.systemBackground
        card.layer.cornerRadius = 12

        let title = UILabel()
        title.text = actionBanner(action)
        title.font = .systemFont(ofSize: 13, weight: .semibold)
        title.numberOfLines = 2

        let detail = UILabel()
        detail.text = action.title
        detail.font = .systemFont(ofSize: 14)
        detail.numberOfLines = 3

        let evidence = UILabel()
        evidence.text = "来自：「\(action.evidence)」"
        evidence.font = .italicSystemFont(ofSize: 12)
        evidence.textColor = .secondaryLabel
        evidence.numberOfLines = 2

        let buttons = UIStackView()
        buttons.axis = .horizontal
        buttons.spacing = 8
        buttons.distribution = .fillEqually

        let confirm = UIButton(type: .system)
        confirm.setTitle(confirmTitle(action), for: .normal)
        confirm.addAction(UIAction { [weak self] _ in
            Task { await self?.confirm(action) }
        }, for: .touchUpInside)

        let ignore = UIButton(type: .system)
        ignore.setTitle("忽略", for: .normal)
        ignore.addAction(UIAction { [weak self] _ in
            self?.actions.removeAll { $0.id == action.id }
            self?.renderResults()
        }, for: .touchUpInside)

        buttons.addArrangedSubview(confirm)
        buttons.addArrangedSubview(ignore)

        card.addArrangedSubview(title)
        card.addArrangedSubview(detail)
        card.addArrangedSubview(evidence)
        card.addArrangedSubview(buttons)
        return card
    }

    private func actionBanner(_ action: AlfredKeyboardAPI.Action) -> String {
        switch action.type {
        case "calendar_event": return "检测到日程"
        case "follow_up": return "Alfred 检测到一个后续行动"
        case "commitment": return "检测到承诺"
        default: return "检测到待办"
        }
    }

    private func confirmTitle(_ action: AlfredKeyboardAPI.Action) -> String {
        switch action.type {
        case "calendar_event": return "添加日历"
        case "follow_up": return "添加跟进"
        default: return "加入 Alfred"
        }
    }

    private func toneLabel(_ tone: String) -> String {
        switch tone {
        case "caring": return "关心"
        case "brief": return "简短"
        default: return "自然"
        }
    }

    @objc private func insertReplyTapped(_ sender: UIButton) {
        let idx = sender.tag
        guard replies.indices.contains(idx) else { return }
        textDocumentProxy.insertText(replies[idx].body)
    }

    @MainActor
    private func confirm(_ action: AlfredKeyboardAPI.Action) async {
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
            renderResults()
            statusLabel.text = "已加入 Alfred"
        } catch {
            statusLabel.text = "保存失败：\(error.localizedDescription)"
        }
    }
}
