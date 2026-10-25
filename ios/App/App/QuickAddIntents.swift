// "Add expense" and "Add cash" actions for the Shortcuts app (iOS 17+). They run
// without opening VaultLocks — also from the lock screen, e.g. with Back Tap set to
// a shortcut — ask for the amount, category and account with the system's own
// prompts, and leave one encrypted entry for the next unlock (QuickAddStore).

import AppIntents
import Foundation

@available(iOS 17.0, *)
enum ExpenseCategoryChoice: String, AppEnum {
    case food, coffee, groceries, transport, bills, housing, shopping, health, entertainment, education, personal, family, other

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Category"
    // Ids match MONEY_CATEGORIES in src/shared/money.ts.
    static let caseDisplayRepresentations: [ExpenseCategoryChoice: DisplayRepresentation] = [
        .food: DisplayRepresentation(title: "Food & Drinks", image: .init(systemName: "fork.knife")),
        .coffee: DisplayRepresentation(title: "Coffee", image: .init(systemName: "cup.and.saucer")),
        .groceries: DisplayRepresentation(title: "Groceries", image: .init(systemName: "cart")),
        .transport: DisplayRepresentation(title: "Fare & Transport", image: .init(systemName: "bus")),
        .bills: DisplayRepresentation(title: "Bills & Utilities", image: .init(systemName: "bolt")),
        .housing: DisplayRepresentation(title: "Housing", image: .init(systemName: "house")),
        .shopping: DisplayRepresentation(title: "Shopping", image: .init(systemName: "bag")),
        .health: DisplayRepresentation(title: "Health", image: .init(systemName: "heart")),
        .entertainment: DisplayRepresentation(title: "Entertainment", image: .init(systemName: "film")),
        .education: DisplayRepresentation(title: "Education", image: .init(systemName: "book")),
        .personal: DisplayRepresentation(title: "Personal Care", image: .init(systemName: "sparkles")),
        .family: DisplayRepresentation(title: "Family & Gifts", image: .init(systemName: "person.2")),
        .other: DisplayRepresentation(title: "Other", image: .init(systemName: "ellipsis.circle"))
    ]
}

@available(iOS 17.0, *)
enum IncomeCategoryChoice: String, AppEnum {
    case topup, salary, business, gifts
    case otherIncome = "other-income"

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Category"
    static let caseDisplayRepresentations: [IncomeCategoryChoice: DisplayRepresentation] = [
        .topup: DisplayRepresentation(title: "Cash in / Top-up", image: .init(systemName: "wallet.pass")),
        .salary: DisplayRepresentation(title: "Salary", image: .init(systemName: "banknote")),
        .business: DisplayRepresentation(title: "Business", image: .init(systemName: "briefcase")),
        .gifts: DisplayRepresentation(title: "Gifts & Allowance", image: .init(systemName: "gift")),
        .otherIncome: DisplayRepresentation(title: "Other income", image: .init(systemName: "plus.circle"))
    ]
}

/** One of the vault's accounts (names only, from inbox.meta), or "No account". */
@available(iOS 17.0, *)
struct VaultAccountEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Account"
    static let defaultQuery = VaultAccountQuery()
    static let noneId = "none"

    let id: String
    let name: String
    let kind: String

    var displayRepresentation: DisplayRepresentation {
        let kindName: String
        switch kind {
        case "cash": kindName = "Cash"
        case "ewallet": kindName = "E-wallet"
        case "bank": kindName = "Bank"
        case "credit": kindName = "Credit card"
        case "none": kindName = "Not linked to an account"
        default: kindName = "Account"
        }
        return DisplayRepresentation(title: "\(name)", subtitle: "\(kindName)")
    }
}

@available(iOS 17.0, *)
struct VaultAccountQuery: EntityQuery {
    func entities(for identifiers: [VaultAccountEntity.ID]) async throws -> [VaultAccountEntity] {
        all().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [VaultAccountEntity] {
        all()
    }

    private func all() -> [VaultAccountEntity] {
        QuickAddStore.meta().accounts.map { VaultAccountEntity(id: $0.id, name: $0.name, kind: $0.kind) }
            + [VaultAccountEntity(id: VaultAccountEntity.noneId, name: "No account", kind: "none")]
    }
}

@available(iOS 17.0, *)
private func save(kind: String, amount: Double, category: String, categoryName: String, account: VaultAccountEntity, note: String?) -> IntentDialog {
    guard QuickAddStore.isReady else { return "Open VaultLocks and unlock it once to turn on quick add." }
    let minor = Int64((amount * 100).rounded())
    let accountId = account.id == VaultAccountEntity.noneId ? nil : account.id
    do {
        try QuickAddStore.add(kind: kind, amount: minor, category: category, accountId: accountId, note: note ?? "")
    } catch let failure as QuickAddStore.Failure {
        return "\(failure.message)"
    } catch {
        return "Couldn't save. Please try again."
    }
    let money = NumberFormatter()
    money.numberStyle = .currency
    money.currencyCode = QuickAddStore.meta().currency
    let text = money.string(from: NSNumber(value: Double(minor) / 100)) ?? String(format: "%.2f", Double(minor) / 100)
    let where_ = accountId == nil ? "" : (kind == "income" ? " to \(account.name)" : " from \(account.name)")
    return "Saved \(text) · \(categoryName)\(where_). It's encrypted and shows in VaultLocks after you unlock."
}

@available(iOS 17.0, *)
struct AddExpenseIntent: AppIntent {
    static let title: LocalizedStringResource = "Add expense"
    static let description = IntentDescription("Adds an expense to VaultLocks without opening it, even from the lock screen. It stays encrypted until you unlock VaultLocks.")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Amount", requestValueDialog: "How much?")
    var amount: Double

    @Parameter(title: "Category", requestValueDialog: "What was it for?")
    var category: ExpenseCategoryChoice

    @Parameter(title: "Paid with", requestValueDialog: "Paid with which account?")
    var account: VaultAccountEntity

    @Parameter(title: "Note")
    var note: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Add expense of \(\.$amount) for \(\.$category) from \(\.$account)") {
            \.$note
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let name = ExpenseCategoryChoice.caseDisplayRepresentations[category]?.title ?? "Other"
        return .result(dialog: save(kind: "expense", amount: amount, category: category.rawValue, categoryName: String(localized: name), account: account, note: note))
    }
}

@available(iOS 17.0, *)
struct AddCashIntent: AppIntent {
    static let title: LocalizedStringResource = "Add cash"
    static let description = IntentDescription("Adds money coming in (cash in, salary, allowance) to VaultLocks without opening it, even from the lock screen.")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Amount", requestValueDialog: "How much came in?")
    var amount: Double

    @Parameter(title: "Category", requestValueDialog: "What kind?")
    var category: IncomeCategoryChoice

    @Parameter(title: "Add to", requestValueDialog: "Add to which account?")
    var account: VaultAccountEntity

    @Parameter(title: "Note")
    var note: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Add cash of \(\.$amount) as \(\.$category) to \(\.$account)") {
            \.$note
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let name = IncomeCategoryChoice.caseDisplayRepresentations[category]?.title ?? "Other income"
        return .result(dialog: save(kind: "income", amount: amount, category: category.rawValue, categoryName: String(localized: name), account: account, note: note))
    }
}

/**
 * Kloud through Siri: "Hey Siri, Kloud in VaultLocks" → "What should I add?" →
 * "lunch 150 from GCash" / "remind me to pay rent tomorrow at 9". The sentence is
 * stored encrypted (QuickAddStore.addVoice) and understood by the app on unlock;
 * the reply only repeats what was said, so nothing private is spoken.
 */
@available(iOS 17.0, *)
struct KloudIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Kloud"
    static let description = IntentDescription("Tell Kloud an expense or a reminder, like “lunch 150 from GCash” or “remind me to pay rent tomorrow at 9”. Works from the lock screen; it stays encrypted until you unlock VaultLocks.")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "What to add", requestValueDialog: "What should I add?")
    var request: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard QuickAddStore.isReady else { return .result(dialog: "Open VaultLocks and unlock it once to turn on Kloud.") }
        let reply = kloudReply(request, accounts: QuickAddStore.meta().accounts.map { $0.name }, currency: QuickAddStore.meta().currency)
        guard reply.save else { return .result(dialog: "\(reply.text)") }
        do {
            try QuickAddStore.addVoice(request)
        } catch let failure as QuickAddStore.Failure {
            return .result(dialog: "\(failure.message)")
        } catch {
            return .result(dialog: "Couldn't save. Please try again.")
        }
        return .result(dialog: "\(reply.text)")
    }
}

/** What Kloud says back on the lock screen (same rules as KloudSay.java). */
func kloudReply(_ said: String, accounts: [String], currency: String) -> (text: String, save: Bool) {
    var t = said.trimmingCharacters(in: .whitespacesAndNewlines)
    if let wake = t.range(of: "^\\s*(?:hey\\s+|ok(?:ay)?\\s+|hi\\s+)?(?:kloud|cloud|claude|clod)[\\s,]*", options: [.regularExpression, .caseInsensitive]) {
        t.removeSubrange(wake)
    }
    if t.isEmpty { return ("I didn't catch that.", false) }
    let lower = t.lowercased()
    if let task = t.range(of: "^(?:please\\s+)?(?:remind me(?: to)?|set a reminder(?: to)?|add (?:a )?(?:task|to ?do|reminder)(?: to)?|new task|create (?:a )?task|task|to ?do|don'?t forget(?: to)?|paalala)\\s+", options: [.regularExpression, .caseInsensitive]) {
        let what = String(t[task.upperBound...])
        return ("Okay. I'll remind you: \(what). It's set as soon as you unlock VaultLocks.", true)
    }
    guard let amountRange = t.range(of: "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?\\s?(?:k\\b)?", options: [.regularExpression, .caseInsensitive]) else {
        return ("While your phone is locked I can add expenses and reminders, like “lunch 150” or “remind me to call Mama at 7”.", false)
    }
    var raw = String(t[amountRange]).lowercased().replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
    let value: Double
    if raw.hasSuffix("k") {
        raw.removeLast()
        value = (Double(raw.trimmingCharacters(in: .whitespaces)) ?? 0) * 1000
    } else {
        value = Double(raw) ?? 0
    }
    let income = lower.range(of: "^\\+|\\b(salary|sweldo|sahod|income|bonus|allowance|baon|received|refund|cashback|sold|cash ?in|top ?up|deposit)\\b", options: .regularExpression) != nil
    let account = accounts.first { name in
        lower.range(of: "\\b\(NSRegularExpression.escapedPattern(for: name.lowercased()))\\b", options: .regularExpression) != nil
    }
    var what = t
    what.removeSubrange(amountRange)
    what = what.replacingOccurrences(of: "\\b(i spent|spent|i paid|paid|add|log|pesos?|php|from|using|with|via|sa|on|for|cash ?in|top ?up)\\b", with: " ", options: [.regularExpression, .caseInsensitive])
    if let account { what = what.replacingOccurrences(of: account, with: " ", options: .caseInsensitive) }
    what = what.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    let money = NumberFormatter()
    money.numberStyle = .currency
    money.currencyCode = currency
    money.maximumFractionDigits = value.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 2
    let amount = money.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
    if income {
        return ("Done. Added \(amount)\(account.map { " to \($0)" } ?? "").", true)
    }
    return ("Done. \(amount)\(what.isEmpty ? "" : " for \(what)")\(account.map { " from \($0)" } ?? "").", true)
}

/** Ready-made shortcuts: they show up in the Shortcuts app and Back Tap right after install. */
@available(iOS 17.0, *)
struct VaultLocksShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: KloudIntent(),
            phrases: ["Kloud in \(.applicationName)", "Talk to Kloud in \(.applicationName)", "Ask Kloud in \(.applicationName)"],
            shortTitle: "Ask Kloud",
            systemImageName: "waveform.circle.fill"
        )
        AppShortcut(
            intent: AddExpenseIntent(),
            phrases: ["Add expense in \(.applicationName)", "Add an expense to \(.applicationName)"],
            shortTitle: "Add expense",
            systemImageName: "minus.circle.fill"
        )
        AppShortcut(
            intent: AddCashIntent(),
            phrases: ["Add cash in \(.applicationName)"],
            shortTitle: "Add cash",
            systemImageName: "plus.circle.fill"
        )
    }
}
