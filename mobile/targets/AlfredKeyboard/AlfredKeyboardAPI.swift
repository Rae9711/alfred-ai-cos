import Foundation

/// Minimal API client for the keyboard extension (network requires Full Access).
enum AlfredKeyboardAPI {
    struct ParseResponse: Decodable {
        let id: String
        let messages: [Message]
    }

    struct Message: Decodable {
        let id: String
        let sender: String
        let content: String
        let is_selected: Bool
        let weight: Double?
    }

    struct AnalyzeResponse: Decodable {
        let reply_suggestions: [Reply]
        let actions: [Action]
    }

    struct Reply: Decodable {
        let tone: String
        let body: String
    }

    struct Action: Decodable {
        let id: String
        let type: String
        let title: String
        let due_date: String?
        let start: String?
        let end: String?
        let suggested_time: String?
        let confidence: Double
        let evidence: String
        let evidence_message_ids: [String]
        let tier: String
        let status: String
    }

    struct ConfirmResponse: Decodable {
        let kind: String
        let id: String
        let title: String
        let evidence: String?
        let remind_at: String?
        let detail: String?
    }

    enum APIError: Error {
        case notSignedIn
        case badStatus(Int, String)
        case decode
    }

    static func parse(text: String) async throws -> ParseResponse {
        try await post(path: "/api/v1/conversations/parse", body: ["text": text])
    }

    static func analyze(conversation: [String: Any], goal: String) async throws -> AnalyzeResponse {
        try await post(
            path: "/api/v1/conversations/analyze",
            body: ["conversation": conversation, "goal": goal]
        )
    }

    static func confirm(action: Action, conversationId: String?) async throws -> ConfirmResponse {
        var body: [String: Any] = [
            "type": action.type,
            "title": action.title,
            "evidence": action.evidence,
            "evidence_message_ids": action.evidence_message_ids,
            "confidence": action.confidence,
            "suggested_time": action.suggested_time as Any,
            "start": action.start as Any,
            "end": action.end as Any,
            "due_date": action.due_date as Any,
            "set_reminder": action.tier == "explicit_time",
        ]
        if let conversationId {
            body["conversation_id"] = conversationId
        }
        return try await post(path: "/api/v1/conversations/actions/confirm", body: body)
    }

    private static func post<T: Decodable>(path: String, body: [String: Any]) async throws -> T {
        guard let token = AlfredAppGroup.authToken(), !token.isEmpty else {
            throw APIError.notSignedIn
        }
        let base = AlfredAppGroup.apiBaseURL().trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: base + path) else { throw APIError.decode }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: sanitize(body))
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw APIError.badStatus(status, text)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decode
        }
    }

    private static func sanitize(_ value: Any) -> Any {
        if let dict = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (k, v) in dict {
                if v is NSNull { continue }
                if let opt = v as? String? { if let opt { out[k] = opt }; continue }
                out[k] = sanitize(v)
            }
            return out
        }
        if let arr = value as? [Any] {
            return arr.map { sanitize($0) }
        }
        return value
    }
}
