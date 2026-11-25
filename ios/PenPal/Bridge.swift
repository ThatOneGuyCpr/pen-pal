import Foundation
import JavaScriptCore

/// Runs public/logic.js (the rules, shared with the Windows app) and bridge.js inside JavaScriptCore.
/// The open document lives in the JavaScript side; Swift asks for screen-ready JSON and decodes it.
/// Main thread only: a JSContext is not safe to share between threads.
final class Bridge {
    private let context: JSContext
    private(set) var lastError: String?

    init(bundle: Bundle = .main) {
        context = JSContext()!
        context.exceptionHandler = { [weak self] _, exception in
            self?.lastError = exception?.toString() ?? "JavaScript error"
        }
        for name in ["logic", "bridge"] {
            if let url = bundle.url(forResource: name, withExtension: "js"),
               let source = try? String(contentsOf: url, encoding: .utf8) {
                context.evaluateScript(source, withSourceURL: url)
            } else {
                lastError = "Missing \(name).js"
            }
        }
        if let url = bundle.url(forResource: "directory", withExtension: "json"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            invoke("loadDirectory", [source])
        }
    }

    var isReady: Bool {
        guard let pp = context.objectForKeyedSubscript("PP") else { return false }
        return !pp.isUndefined
    }

    @discardableResult
    func invoke(_ name: String, _ args: [Any]) -> JSValue? {
        lastError = nil
        guard let pp = context.objectForKeyedSubscript("PP"), !pp.isUndefined,
              let fn = pp.objectForKeyedSubscript(name), !fn.isUndefined else {
            lastError = "No bridge function \(name)"
            return nil
        }
        let value = fn.call(withArguments: args)
        return lastError == nil ? value : nil
    }

    @discardableResult
    func run(_ name: String, _ args: Any...) -> JSValue? { invoke(name, args) }

    /// A function that returns a JSON string, as text.
    func raw(_ name: String, _ args: Any...) -> String? {
        guard let v = invoke(name, args), v.isString else { return nil }
        return v.toString()
    }

    /// A function that returns a JSON string, decoded.
    func json<T: Decodable>(_ type: T.Type, _ name: String, _ args: Any...) -> T? {
        guard let v = invoke(name, args), v.isString, let s = v.toString(), let data = s.data(using: .utf8) else { return nil }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            lastError = "\(name): \(error)"
            return nil
        }
    }
}

/// JSON text for passing a Codable value into the bridge.
func jsonText<T: Encodable>(_ value: T) -> String {
    guard let data = try? JSONEncoder().encode(value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
}
