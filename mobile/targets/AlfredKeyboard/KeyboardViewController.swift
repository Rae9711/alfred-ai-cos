import UIKit

/// Custom keyboard state machine:
/// IDLE → IMPORTING → CONTEXT_REVIEW → GENERATING → REPLY_READY → EDITING
final class KeyboardViewController: UIInputViewController {
    private enum Phase {
        case idle
        case importing
        case contextReview
        case generating
        case replyReady
        case editing
        case error(String)
    }

    private let root = UIStackView()
    private let contentScroll = UIScrollView()
    private let contentStack = UIStackView()
    private let chromeBar = UIStackView()

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
    private var showingContextDetail = false
    private var showingActionsPanel = false
    private var statusBanner: String?

    private let accent = UIColor(red: 0.23, green: 0.36, blue: 0.66, alpha: 1)
    private let paper = UIColor(red: 0.96, green: 0.95, blue: 0.92, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = paper
        AlfredAppGroup.markKeyboardSeen()
        setupChrome()
        render()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        AlfredAppGroup.markKeyboardSeen()
        if case .idle = phase { render() }
    }

    // MARK: - Layout

    private func setupChrome() {
        root.axis = .vertical
        root.spacing = 8
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            root.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6),
            view.heightAnchor.constraint(equalToConstant: 320),
        ])

        contentScroll.translatesAutoresizingMaskIntoConstraints = false
        contentStack.axis = .vertical
        contentStack.spacing = 8
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        contentScroll.addSubview(contentStack)
        root.addArrangedSubview(contentScroll)

        chromeBar.axis = .horizontal
        chromeBar.spacing = 6
        chromeBar.distribution = .fill
        chromeBar.alignment = .center
        root.addArrangedSubview(chromeBar)

        NSLayoutConstraint.activate([
            contentScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 250),
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
    }

    private func render() {
        clearContent()
        renderChrome()
        switch phase {
        case .idle: renderIdle()
        case .importing: renderLoading("正在导入…")
        case .contextReview: renderContextReview()
        case .generating: renderLoading("Alfred 正在理解对话…")
        case .replyReady: renderReplyReady()
        case .editing: renderEditing()
        case .error(let msg): renderError(msg)
        }
    }

    private func renderChrome() {
        let next = makeGhostButton("🌐", action: #selector(advanceTapped))
        next.widthAnchor.constraint(equalToConstant: 40).isActive = true
        chromeBar.addArrangedSubview(next)

        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        chromeBar.addArrangedSubview(spacer)

        let space = makeGhostButton("空格", action: #selector(spaceTapped))
        chromeBar.addArrangedSubview(space)

        let back = makeGhostButton("⌫", action: #selector(backspaceTapped))
        back.widthAnchor.constraint(equalToConstant: 44).isActive = true
        chromeBar.addArrangedSubview(back)

        let ret = makeGhostButton("↵", action: #selector(returnTapped))
        ret.widthAnchor.constraint(equalToConstant: 40).isActive = true
        chromeBar.addArrangedSubview(ret)
    }

    // MARK: - Phase views

    private func renderIdle() {
        if let gate = authGateMessage() {
            let label = makeLabel(gate, size: 14, weight: .medium, color: .secondaryLabel)
            label.textAlignment = .center
            contentStack.addArrangedSubview(label)
            return
        }

        let hint = makeLabel("复制微信聊天后，点击导入", size: 15, weight: .medium)
        hint.textAlignment = .center
        contentStack.addArrangedSubview(hint)

        if let banner = statusBanner {
            contentStack.addArrangedSubview(makeLabel(banner, size: 12, color: .secondaryLabel))
        }

        let importBtn = makePrimaryButton("导入所选消息", action: #selector(importTapped))
        contentStack.addArrangedSubview(importBtn)
    }

    private func renderLoading(_ text: String) {
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()
        contentStack.addArrangedSubview(spinner)
        let label = makeLabel(text, size: 14, weight: .medium, color: .secondaryLabel)
        label.textAlignment = .center
        contentStack.addArrangedSubview(label)
    }

    private func renderError(_ message: String) {
        let label = makeLabel(message, size: 14, weight: .medium, color: UIColor.systemOrange)
        label.textAlignment = .center
        contentStack.addArrangedSubview(label)
        contentStack.addArrangedSubview(makePrimaryButton("重试", action: #selector(resetToIdle)))
    }

    private func renderContextReview() {
        let total = parsedMessages.count
        let selected = selectedMessageIds.count
        contentStack.addArrangedSubview(
            makeLabel("识别到 \(total) 条消息 / 已选择最相关的 \(selected) 条", size: 14, weight: .semibold)
        )

        if showingContextDetail {
            for msg in parsedMessages.prefix(8) {
                let on = selectedMessageIds.contains(msg.id)
                let row = makeLabel(
                    "\(on ? "●" : "○") \(msg.sender)：\(msg.content)",
                    size: 12,
                    color: on ? .label : .secondaryLabel
                )
                row.numberOfLines = 2
                contentStack.addArrangedSubview(row)
            }
        }

        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 8
        row.distribution = .fillEqually
        row.addArrangedSubview(makeSecondaryButton(
            showingContextDetail ? "收起上下文" : "查看上下文",
            action: #selector(toggleContextDetail)
        ))
        row.addArrangedSubview(makePrimaryButton("继续", action: #selector(continueFromContext)))
        contentStack.addArrangedSubview(row)
    }

    private func renderReplyReady() {
        contentStack.addArrangedSubview(makeLabel("Alfred 理解", size: 11, weight: .semibold, color: .secondaryLabel))
        contentStack.addArrangedSubview(makeLabel(insight.isEmpty ? "已分析对话，可插入回复" : insight, size: 13, weight: .medium))

        contentStack.addArrangedSubview(makeLabel("建议回复", size: 11, weight: .semibold, color: .secondaryLabel))
        let reply = currentReply()?.body ?? "（暂无建议）"
        let body = makeLabel(reply, size: 14)
        body.numberOfLines = 5
        contentStack.addArrangedSubview(paddedView(body))

        let actionsRow = UIStackView()
        actionsRow.axis = .horizontal
        actionsRow.spacing = 8
        actionsRow.distribution = .fillEqually
        actionsRow.addArrangedSubview(makeSecondaryButton("换一个", action: #selector(cycleReply)))
        actionsRow.addArrangedSubview(makeSecondaryButton("编辑", action: #selector(enterEditing)))
        actionsRow.addArrangedSubview(makePrimaryButton("插入", action: #selector(insertCurrentReply)))
        contentStack.addArrangedSubview(actionsRow)

        let calendarCount = actions.filter { $0.type == "calendar_event" }.count
        let followCount = actions.filter { $0.type == "follow_up" || $0.type == "commitment" || $0.type == "task" }.count
        contentStack.addArrangedSubview(
            makeLabel("📅 发现 \(calendarCount) 个日程   ✓ \(followCount) 个跟进", size: 12, color: .secondaryLabel)
        )

        if showingActionsPanel {
            for action in actions.prefix(4) {
                contentStack.addArrangedSubview(makeActionRow(action))
            }
        } else if !actions.isEmpty {
            contentStack.addArrangedSubview(makeSecondaryButton("查看并确认", action: #selector(toggleActionsPanel)))
        }

        let expandRow = UIStackView()
        expandRow.axis = .horizontal
        expandRow.alignment = .center
        let brand = makeLabel("Alfred", size: 13, weight: .semibold, color: accent)
        expandRow.addArrangedSubview(brand)
        let spacer = UIView()
        expandRow.addArrangedSubview(spacer)
        expandRow.addArrangedSubview(makeGhostButton("展开 ↗", action: #selector(expandTapped)))
        contentStack.addArrangedSubview(expandRow)

        if let banner = statusBanner {
            contentStack.addArrangedSubview(makeLabel(banner, size: 12, color: .secondaryLabel))
        }
    }

    private func renderEditing() {
        contentStack.addArrangedSubview(makeLabel("编辑回复", size: 13, weight: .semibold))
        let tv = UITextView()
        tv.font = .systemFont(ofSize: 14)
        tv.text = currentReply()?.body ?? ""
        tv.backgroundColor = .systemBackground
        tv.layer.cornerRadius = 10
        tv.heightAnchor.constraint(equalToConstant: 90).isActive = true
        editTextView = tv
        contentStack.addArrangedSubview(tv)

        let tones = UIStackView()
        tones.axis = .horizontal
        tones.spacing = 6
        tones.distribution = .fillEqually
        tones.addArrangedSubview(makeSecondaryButton("更简短", action: #selector(rewriteBrief)))
        tones.addArrangedSubview(makeSecondaryButton("更温柔", action: #selector(rewriteCaring)))
        tones.addArrangedSubview(makeSecondaryButton("更直接", action: #selector(rewriteDirect)))
        contentStack.addArrangedSubview(tones)

        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 8
        row.distribution = .fillEqually
        row.addArrangedSubview(makeSecondaryButton("返回", action: #selector(exitEditing)))
        row.addArrangedSubview(makePrimaryButton("插入回复", action: #selector(insertEditedReply)))
        contentStack.addArrangedSubview(row)
    }

    private func makeActionRow(_ action: AlfredKeyboardAPI.Action) -> UIView {
        let card = UIStackView()
        card.axis = .vertical
        card.spacing = 4
        card.isLayoutMarginsRelativeArrangement = true
        card.layoutMargins = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 10

        card.addArrangedSubview(makeLabel(action.title, size: 13, weight: .medium))
        let evidence = makeLabel("「\(action.evidence)」", size: 11, color: .secondaryLabel)
        evidence.numberOfLines = 2
        card.addArrangedSubview(evidence)

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
            self?.render()
        }, for: .touchUpInside)

        buttons.addArrangedSubview(confirm)
        buttons.addArrangedSubview(ignore)
        card.addArrangedSubview(buttons)
        return card
    }

    // MARK: - Auth gate

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
        phase = .idle
        statusBanner = nil
        showingContextDetail = false
        showingActionsPanel = false
        render()
    }

    @objc private func advanceTapped() { advanceToNextInputMode() }
    @objc private func spaceTapped() { textDocumentProxy.insertText(" ") }
    @objc private func backspaceTapped() { textDocumentProxy.deleteBackward() }
    @objc private func returnTapped() { textDocumentProxy.insertText("\n") }

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

            // Prefer server selection; if none selected, take top by weight.
            var selected = Set(parsed.messages.filter(\.is_selected).map(\.id))
            if selected.isEmpty {
                let ranked = parsed.messages.sorted { ($0.weight ?? 0) > ($1.weight ?? 0) }
                selected = Set(ranked.prefix(min(6, ranked.count)).map(\.id))
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
            phase = .contextReview
            render()
        } catch {
            phase = .error(mapError(error))
            render()
        }
    }

    @objc private func toggleContextDetail() {
        showingContextDetail.toggle()
        render()
    }

    @objc private func continueFromContext() {
        phase = .generating
        render()
        Task { await runAnalyze() }
    }

    @MainActor
    private func runAnalyze(tones: [String]? = nil) async {
        guard var conversation = conversationJSON else {
            phase = .error("会话丢失，请重新导入")
            render()
            return
        }
        // Sync selection into payload.
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
            insight = analyzed.insight?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if insight.isEmpty {
                if let first = actions.first?.title, !first.isEmpty {
                    insight = first
                } else {
                    insight = "已分析对话，可插入回复"
                }
            }
            phase = .replyReady
            render()
        } catch {
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

    @objc private func exitEditing() {
        if let text = editTextView?.text, !replies.isEmpty {
            let tone = replies[replyIndex].tone
            replies[replyIndex] = AlfredKeyboardAPI.Reply(tone: tone, body: text)
        }
        phase = .replyReady
        render()
    }

    @objc private func insertCurrentReply() {
        guard let body = currentReply()?.body else { return }
        textDocumentProxy.insertText(body)
        statusBanner = "已插入"
        render()
    }

    @objc private func insertEditedReply() {
        let text = editTextView?.text ?? currentReply()?.body ?? ""
        guard !text.isEmpty else { return }
        textDocumentProxy.insertText(text)
        if !replies.isEmpty {
            let tone = replies[replyIndex].tone
            replies[replyIndex] = AlfredKeyboardAPI.Reply(tone: tone, body: text)
        }
        phase = .replyReady
        statusBanner = "已插入"
        render()
    }

    @objc private func rewriteBrief() { Task { await rewrite(tone: "brief") } }
    @objc private func rewriteCaring() { Task { await rewrite(tone: "caring") } }
    @objc private func rewriteDirect() { Task { await rewrite(tone: "natural") } }

    @MainActor
    private func rewrite(tone: String) async {
        let draft = editTextView?.text
        phase = .generating
        render()
        await runAnalyze(tones: [tone])
        if case .error = phase {
            // Network failed — fall back to a local tweak so editing still works.
            if let draft, !draft.isEmpty {
                replies = [AlfredKeyboardAPI.Reply(tone: tone, body: localRewrite(draft, tone: tone))]
                replyIndex = 0
                phase = .editing
                render()
                editTextView?.text = currentReply()?.body
            }
            return
        }
        if let idx = replies.firstIndex(where: { $0.tone == tone }) {
            replyIndex = idx
        } else {
            replyIndex = 0
        }
        phase = .editing
        render()
        editTextView?.text = currentReply()?.body
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

    @objc private func toggleActionsPanel() {
        showingActionsPanel.toggle()
        render()
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

    private func openContainingApp(urlString: String) {
        guard let url = URL(string: urlString) else { return }
        var responder: UIResponder? = self
        let selector = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: selector) {
                r.perform(selector, with: url)
                return
            }
            responder = r.next
        }
        extensionContext?.open(url, completionHandler: nil)
    }

    @MainActor
    private func confirm(_ action: AlfredKeyboardAPI.Action) async {
        // Complex calendar with start/end → open app; simple follow-ups confirm in keyboard.
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

    private func confirmTitle(_ action: AlfredKeyboardAPI.Action) -> String {
        switch action.type {
        case "calendar_event": return "添加日历"
        case "follow_up": return "添加跟进"
        default: return "加入 Alfred"
        }
    }

    // MARK: - UI helpers

    private func makeLabel(
        _ text: String,
        size: CGFloat,
        weight: UIFont.Weight = .regular,
        color: UIColor = .label
    ) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textColor = color
        label.numberOfLines = 0
        return label
    }

    private func paddedView(_ inner: UIView) -> UIView {
        let wrap = UIView()
        wrap.backgroundColor = .systemBackground
        wrap.layer.cornerRadius = 10
        inner.translatesAutoresizingMaskIntoConstraints = false
        wrap.addSubview(inner)
        NSLayoutConstraint.activate([
            inner.leadingAnchor.constraint(equalTo: wrap.leadingAnchor, constant: 10),
            inner.trailingAnchor.constraint(equalTo: wrap.trailingAnchor, constant: -10),
            inner.topAnchor.constraint(equalTo: wrap.topAnchor, constant: 8),
            inner.bottomAnchor.constraint(equalTo: wrap.bottomAnchor, constant: -8),
        ])
        return wrap
    }

    private func makePrimaryButton(_ title: String, action: Selector) -> UIButton {
        var config = UIButton.Configuration.filled()
        config.title = title
        config.baseBackgroundColor = accent
        config.baseForegroundColor = .white
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)
        let button = UIButton(configuration: config)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func makeSecondaryButton(_ title: String, action: Selector) -> UIButton {
        var config = UIButton.Configuration.bordered()
        config.title = title
        config.baseForegroundColor = accent
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8)
        let button = UIButton(configuration: config)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func makeGhostButton(_ title: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 14, weight: .medium)
        button.setTitleColor(.label, for: .normal)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }
}
