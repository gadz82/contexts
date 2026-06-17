# AGENTS.md

## Project

**products-service** — NestJS microservice for e-commerce product management (CRUD) with Sequelize ORM + MySQL.

## Architecture

- **Framework**: NestJS (standalone microservice)
- **Language**: TypeScript (strict mode)
- **ORM**: Sequelize + sequelize-typescript
- **Database**: MySQL 8.0
- **Containerization**: Docker Compose (app, mysql with healthchecks)
- **Testing**: Jest (unit), Newman (integration)
- **CI/CD**: GitHub Actions + GitLab CI (dual-platform)
- **Versioning**: Semantic Release + Conventional Commits

## Domain

Single module: **Products**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/products` | POST | Create product (name, productToken, price, stock) |
| `/products` | GET | List with pagination (?page, ?limit, ?pt, ?page[size], ?page[after]) |
| `/products/:productToken` | GET | Get single product |
| `/products/:productToken` | PATCH | Update product stock (absolute set, optimistic locking) |
| `/products/:productToken/stock` | PATCH | Adjust product stock by delta (atomic, concurrent-safe) |
| `/products/:productToken` | DELETE | Remove product |

Table `products`: id (PK auto-increment), productToken (unique), name, price (decimal), stock (integer), version (integer, for optimistic locking).

## Response Format

- JSON:API structure (`data.type`, `data.id` = productToken, `data.attributes`)
- `productToken` is exposed in `data.attributes` for GET endpoints
- `id` is excluded from `data.attributes` (only used as JSON:API resource id)

## Error Handling

- **Development**: Returns specific validation error messages (first error only via `stopAtFirstError`)
- **Production**: Returns generic HTTP status label only (e.g., `BAD_REQUEST`), no details disclosed
- Controlled by `NODE_ENV` environment variable

## Code Standards

| Rule | Value |
|------|-------|
| Indentation | Tabs (width 4) |
| Print width | 150 |
| End of line | LF |
| Trailing comma | None |
| Quotes | Single |
| Semicolons | Yes |
| Comments | Minimal, few words at critical logic only |
| Tests | BDD nested describe (Class → Method → behavior) |
| Commits | Semantic Release styled Commits (`type(scope): description`) |

## How to Work on This Project

1. Read `.knowledge/AGENTS.md` for execution strategy
2. Read `.knowledge/prompts/EXECUTION_MATRIX.md` to find next pending prompt
3. Execute prompts in order — each is idempotent (check → implement if needed → validate → commit)

## Test execution and validation
Always use package.json script, e.g. to run Unit Tests use npm run unit-test

### Available scripts
| Script | Purpose |
|--------|---------|
| `npm run unit-test` | Execute Jest unit test suite |
| `npm run integration-test` | Execute Newman products CRUD collection |
| `npm run integration-test:pagination` | Execute Newman pagination collection |
| `npm run integration-test:errors` | Execute Newman error handling collection |
| `npm run integration-test:stock` | Execute Newman stock adjust collection |
| `npm run integration-test:all` | Execute all Newman collections |
