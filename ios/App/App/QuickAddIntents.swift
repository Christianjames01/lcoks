// "Add expense" and "Add cash" actions for the Shortcuts app (iOS 17+). They run
// without opening VaultLocks — also from the lock screen, e.g. with Back Tap set to
// a shortcut — ask for the amount, category and account with the system's own
// prompts, and leave one encrypted entry for the next unlock (QuickAddStore).

import AppIntents
import Foundation

@available(iOS 17.0, *)
enum ExpenseCategoryChoice: String, AppEnum {
    case food, groceries, transport, bills, housing, shopping, health, entertainment, education, personal, family, other

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Category"
    // Ids match MONEY_CATEGORIES in src/shared/money.ts.
    static let caseDisplayRepresentations: [ExpenseCategoryChoice: DisplayRepresentation] = [
        .food: DisplayRepresentation(title: "Food & Drinks", image: .init(systemName: "fork.knife")),
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

/** Ready-made shortcuts: they show up in the Shortcuts app and Back Tap right after install. */
@available(iOS 17.0, *)
struct VaultLocksShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
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
