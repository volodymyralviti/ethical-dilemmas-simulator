# Ethical Dilemmas Simulator (Симулятор етичних дилем)

Інтерактивний освітній вебзастосунок українською мовою для розвитку етичного мислення, аналізу ціннісних компромісів та прийняття обґрунтованих рішень у секторі безпеки й оборони України.

Застосунок моделює неоднозначні службові ситуації в умовах дефіциту часу й неповної інформації. Користувач досліджує альтернативи, приймає послідовні рішення, стикається з негайними та відкладеними наслідками й аналізує підсумковий розбір (Debrief) із посиланнями на нормативні та методичні джерела.

> **Важливо:** симулятор **не є** психометричним тестом, інструментом кадрового відбору чи системою оцінювання моральності особи. Він не виставляє «загального балу доброчесності» людині та не збирає персональних даних учасників.

---

## Технологічний стек

| Рівень | Технології |
|---|---|
| **Frontend (`apps/client`)** | Angular 21 (Standalone Components, Signals, Reactive Forms, Angular Router, RxJS), Socket.IO Client, SCSS |
| **Backend (`apps/server`)** | NestJS 11 (Express adapter, CommonJS), REST API (`/api/*`), WebSocket Gateway (`@nestjs/websockets` + Socket.IO) |
| **Domain DSL (`packages/scenario-schema`)** | TypeScript 5, Zod 4, структурний і семантичний валідатор графа сценарію та метаданих джерел |
| **Simulation Engine (`packages/scenario-engine`)** | Чистий детермінований TypeScript без мережевих/UI/LLM-залежностей |
| **Інфраструктура та інструменти** | `pnpm 10.0.0` Monorepo Workspaces, Node.js `22.22.3`, Jasmine/Karma, Jest/Supertest, GitHub Actions CI, Render Blueprint (`render.yaml`) |

---

## Архітектура та структура монорепозиторію

```mermaid
flowchart LR
  Browser[Angular 21: Каталог / Solo / Studio / Classroom]
  Gateway[Production Gateway / Dev Proxy: Same-Origin HTTP + WS]
  API[NestJS 11: Scenario API + Protected Author/Reviewer]
  Rooms[Socket.IO: Ephemeral Classroom Sessions]
  Store[(JSON Scenario Store: Single-Process File Adapter)]
  Schema[@eds/scenario-schema: Zod DSL v1 + Graph Validator]
  Engine[@eds/scenario-engine: Pure Deterministic Runtime]

  Browser -->|HTTP + WebSocket| Gateway
  Gateway -->|Static SPA + /scenarios/*.json| Browser
  Gateway -->|/api/*| API
  Gateway -->|/api/classroom-socket| Rooms
  API --> Store
  API --> Schema
  Rooms --> Engine
  Browser -->|Solo / Preview| Engine
  Engine --> Schema
```

```text
ethical-dilemmas-simulator/
├── apps/
│   ├── client/                  # Angular 21 SPA (каталог, solo, debrief, classroom, studio)
│   └── server/                  # NestJS 11 API + Socket.IO classroom gateway + JSON file store
├── packages/
│   ├── scenario-schema/         # Zod-схеми Scenario DSL v1, перевірка графа, маршрутів і джерел
│   └── scenario-engine/         # Детермінований рушій переходів, метрик і відкладених наслідків
├── content/
│   ├── scenarios/               # JSON-сценарії та маніфест публічного демокаталогу (index.json)
│   ├── teaching-notes/          # Методичні нотатки до сценаріїв
│   └── qa/                      # Автоматизовані перевірки маршрутів, джерел та матриць переходів
├── deploy/
│   ├── render-start.mjs         # Single-origin production шлюз (Angular статика + /api + WebSocket)
│   ├── nginx.conf               # Конфігурація Nginx для виділеного Linux-сервера
│   ├── eds-api.service          # Systemd unit для Linux-сервера
│   └── api.env.example          # Приклад серверних змінних оточення
├── docs/                        # Архітектурні рішення (ADR), звіти безпеки, runbook та документація
├── scripts/                     # Перевірка безпеки релізу (check-release-safety.mjs) та снапшоти
└── render.yaml                  # Infrastructure-as-Code Blueprint для деплою на Render
```

---

## Основний функціонал та сценарії використання

### 1. Індивідуальне проходження (Solo Mode)
- **Маршрути:** `/scenarios` → `/scenarios/:id/play` → `/scenarios/:id/debrief`.
- Доступне без реєстрації та авторизації.
- У публічному демокаталозі представлено **3 оригінальні вигадані та знеособлені навчальні сценарії** (кожен містить 12 вузлів, 14 варіантів вибору, 4 фінали та 8 повних маршрутів по **рівно 3 послідовні рішення**):
  1. **«Підпис під сумнівом»** (`report-under-pressure`)
  2. **«Хто заслуговує на місце?»** (`fair-selection`)
  3. **«Тиша після шикування»** (`quiet-after-formation`)
- *(Два додаткові CIDS-адаптовані кейси — `urgent-supply` та `truth-under-pressure` — збережено в репозиторії як архівний і регресійний контент).*
- **Детермінована модель наслідків:** кожен вибір змінює 4 незалежні показники (`прозорість`, `справедливість`, `довіра`, `ефективність`, базове значення `0`, крок ефекту від `-10` до `+10`) і може планувати **відкладені наслідки** (`after_decisions` або `on_enter_node`), які спрацьовують рівно один раз на наступних етапах.
- **Debrief (Підсумковий розбір):** відображає повну хронологію прийнятих рішень, негайні та відкладені ефекти (включно з нереалізованими подіями інших гілок), конфлікт цінностей, питання для саморефлексії за 6-кроковою моделлю CIDS та перелік нормативних джерел.

### 2. Групове аудиторне заняття (Classroom Mode)
- **Маршрути:** `/classroom/host` (ведучий/викладач) та `/classroom/join` або `/classroom/join/:pin` (учасники).
- Ведучий створює сесію, отримує 6-значний PIN-код та посилання для підключення групи.
- Учасники приєднуються анонімно (без імен, email або облікових записів) і подають один голос у відкритому раунді через WebSocket (`/api/classroom-socket`).
- **Приватність за дизайном:**
  - Індивідуальні траєкторії та голоси не логуються і не зберігаються на диску (сесії живуть лише в оперативній пам'яті з автоочищенням за TTL).
  - До закриття раунду проміжний розподіл голосів не транслюється.
  - Після закриття раунду показується **лише агрегований розподіл**, і тільки якщо проголосувало **не менше 3 учасників** (`CLASSROOM_MIN_PARTICIPANTS=3`). При 1–2 голосах точні цифри приховуються для захисту анонімності.

### 3. Майстерня сценаріїв (Scenario Studio)
- **Публічна демо-майстерня (`/studio/demo`):** працює без ключів і паролів прямо в пам'яті вкладки браузера. Дозволяє створити сценарій із шаблону або імпортувати JSON, відредагувати вузли, переходи, ефекти й нормативні джерела через форми, перевірити граф валідатором, пройти сценарій у попередньому перегляді та експортувати готовий JSON.
- **Захищена авторська майстерня (`/studio`):** серверний CRUD чернеток із контролем ревізій (`expectedRevision`), захищений ключем `AUTHOR_KEY` (вводиться автором під час сесії, не зберігається у коді чи `localStorage`).
- **Експертний контроль публікації (`/api/reviewer/*`):** окремий захищений рівень (`REVIEWER_KEY`) для підтвердження фахового рецензування. Без реального експертного підтвердження сценарії не можуть отримати статус `published` і працюють виключно з явною позначкою деморежиму (`demoOnly: true`).

### 4. Чесний статус джерел і контенту
Усі демонстраційні сценарії в каталозі мають явні метадані `publicationStatus: "draft"`, `contentReview: { status: "draft", demoOnly: true, aiAssisted: true }`, `verificationStatus: "unverified"` та `legalStatus: "uncertain"`. Вони призначені для демонстрації освітньої механіки симулятора і не є офіційним юридичним роз'ясненням.

---

## Покрокова інструкція з локального запуску

### Вимоги до середовища
- **Node.js:** версія `22.22.3` або новіша в межах гілки 22 (`>=22.22.3 <23`, зафіксована у `.nvmrc` та `.npmrc` з `engine-strict=true`).
- **pnpm:** версія `10.0.0` (`corepack enable && corepack prepare pnpm@10.0.0 --activate`).

### Крок 1. Клонування репозиторію
```bash
git clone https://github.com/volodymyralviti/ethical-dilemmas-simulator.git
cd ethical-dilemmas-simulator
git checkout develop
```

### Крок 2. Встановлення залежностей та збірка пакетів
```bash
pnpm install --frozen-lockfile
pnpm build
```
*(Команда `pnpm build` послідовно збирає спільні пакети `@eds/scenario-schema` і `@eds/scenario-engine`, готує статичні сценарії з `content/scenarios/index.json` та виконує production-збірку `apps/client` і `apps/server`).*

### Крок 3. Налаштування змінних оточення
Сервер читає змінні безпосередньо з оточення процесу (файли `.env` автоматично не завантажуються). Документація всіх змінних наведена в [apps/server/.env.example](apps/server/.env.example) та [deploy/api.env.example](deploy/api.env.example).

Для базового локального запуску (каталог, Solo, `/studio/demo`, Classroom) **жодних обов'язкових секретів задавати не потрібно** — застосунок одразу працює з безпечними значеннями за замовчуванням:

| Змінна | За замовчуванням | Призначення |
|---|---|---|
| `PORT` | `3000` | Порт HTTP/WebSocket сервера NestJS |
| `HOST` | *(усі інтерфейси)* | Адреса прив'язки сервера (`127.0.0.1` за локальним reverse-proxy) |
| `AUTHOR_KEY` | `""` *(вимкнено)* | Секретний ключ (≥32 символи) для доступу до захищеного `/studio` та `/api/author/*` |
| `REVIEWER_KEY` | `""` *(вимкнено)* | Окремий секретний ключ рецензента для `/api/reviewer/*` (має відрізнятися від `AUTHOR_KEY`) |
| `SCENARIO_DATA_FILE` | `apps/server/.data/scenarios.json` | Шлях до JSON-файлу збереження сценаріїв (один процес-записувач) |
| `SCENARIO_CONTENT_DIR` | `content/scenarios` | Каталог із початковими JSON-сценаріями та `index.json` |
| `CLASSROOM_TTL_MINUTES` | `30` | Час життя кімнати групового заняття в пам'яті (хвилини) |
| `CLASSROOM_MIN_PARTICIPANTS` | `3` | Мінімальна кількість поданих голосів для показу точного розподілу |
| `CLASSROOM_MAX_PARTICIPANTS` | `100` | Максимальна кількість учасників в одній кімнаті |
| `CLASSROOM_MAX_ROOMS` | `100` | Максимальна кількість одночасно активних кімнат |
| `CLASSROOM_ALLOWED_ORIGIN` | *(same-origin)* | Додатковий дозволений HTTPS Origin для WebSocket (якщо проксі змінює `Host`) |

> **Примітка:** не задавайте змінну `DATABASE_URL` — у поточній версії використовується файлове сховище одного процесу, тому за наявності `DATABASE_URL` сервер зупинить старт, щоб уникнути хибного очікування підключеної PostgreSQL.

Якщо ви хочете протестувати захищений режим автора `/studio`, задайте `AUTHOR_KEY` перед запуском API:
- **Linux / macOS (bash/zsh):**
  ```bash
  export AUTHOR_KEY="local-dev-author-secret-key-at-least-32-chars"
  ```
- **Windows (PowerShell):**
  ```powershell
  $env:AUTHOR_KEY="local-dev-author-secret-key-at-least-32-chars"
  ```

### Крок 4. Запуск у режимі розробки
Запустіть бекенд і фронтенд у двох окремих терміналах із кореня репозиторію:

**Термінал 1 (NestJS API на `http://localhost:3000`):**
```bash
pnpm dev:api
```

**Термінал 2 (Angular Dev Server на `http://localhost:4200` з проксуванням `/api`):**
```bash
pnpm dev:web
```
*(У Windows PowerShell із заблокованими `.ps1`-скриптами використовуйте `pnpm.cmd dev:api` та `pnpm.cmd dev:web`).*

Після запуску відкрийте в браузері:
- `http://localhost:4200/scenarios` — каталог сценаріїв та Solo-режим
- `http://localhost:4200/studio/demo` — публічна демо-майстерня сценаріїв
- `http://localhost:4200/classroom/host` — панель викладача для групового заняття
- `http://localhost:3000/api/health` — перевірка стану API (`{"status":"ok","service":"ethical-dilemmas-api"}`)

### Запуск у Production-режимі (єдиний порт)
Щоб запустити вже зібраний проєкт (`pnpm build`) на одному порту (аналогічно до деплою на Render):
```bash
node deploy/render-start.mjs
```
Застосунок відкриється на `http://localhost:3000` (і статика Angular, і `/api/*`, і WebSocket `/api/classroom-socket`).

### Команди перевірки якості та тестів
```bash
pnpm typecheck                              # Перевірка типів TypeScript та шаблонів Angular
pnpm lint                                   # Перевірка ESLint (scenario-schema, scenario-engine, server)
pnpm test                                   # Усі unit- та e2e-тести (Schema, Engine, Angular, NestJS)
node content/qa/validate.mjs                # Валідація всіх JSON-сценаріїв
node --test content/qa/content.test.mjs     # Перевірка всіх маршрутів сценаріїв через рушій
node scripts/check-release-safety.mjs       # Перевірка відсутності секретів у коді та чесності демо-метаданих
```

---

## Деплой (Live Demo)

Застосунок розгорнуто у хмарі **Render** за допомогою Infrastructure-as-Code конфігурації [render.yaml](render.yaml) та єдиного production-шлюзу [deploy/render-start.mjs](deploy/render-start.mjs):

- **Live Demo (головна сторінка / каталог сценаріїв):** [https://ethical-dilemmas-simulator.onrender.com](https://ethical-dilemmas-simulator.onrender.com)
- **Публічна демо-майстерня (Scenario Studio Demo):** [https://ethical-dilemmas-simulator.onrender.com/studio/demo](https://ethical-dilemmas-simulator.onrender.com/studio/demo)
- **Аудиторне заняття (Classroom Host):** [https://ethical-dilemmas-simulator.onrender.com/classroom/host](https://ethical-dilemmas-simulator.onrender.com/classroom/host)
- **Healthcheck API:** [https://ethical-dilemmas-simulator.onrender.com/api/health](https://ethical-dilemmas-simulator.onrender.com/api/health)

> **Особливість безкоштовного тарифу Render (`plan: free`):** після 15 хвилин неактивності сервіс переходить у режим очікування. Перший запит після паузи може зайняти близько 30–50 секунд для «пробудження» контейнера, після чого застосунок працює миттєво.
