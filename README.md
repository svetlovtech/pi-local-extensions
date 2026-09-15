# pi-local-extensions

Наши локальные расширения для Pi-агента (без upstream, разработаны под себя).

| Каталог | Расширение | Что делает |
|---|---|---|
| `mcp-count/` | mcp-count | Считает включённые MCP-серверы из `~/.pi/agent/mcp.json`, публикует статус `mcp-count` (`MCP: N`) для pi-footer |
| `ctx-cache-colors/` | ctx-cache-colors | 5-зонная цветовая индикация (ANSI 256) заполнения контекста (`ctx`) и cache hit rate (`cache`): чем хуже — тем «краснее» |
| `active-time/` | active-time | Аккумулирует фактическое время работы агента (сумма отрезков `agent_start`→`agent_end`), публикует статус `active-time` (`act 4m 12s`) для pi-footer. Переживает перезапуск сессии через `appendEntry` |
| `session-stats/` | session-stats | Команда `/info` (алиасы `/stats`, `/statistics`, `/session-stats`): харнесс (pi/node/uptime/расширения), workspace (полный pwd, git + добавлено/удалено строк), инструменты (активные/зарегистрированные, MCP-серверы и их инструменты, оценка контекста определений инструментов, топ использованных), skills, разбивка токенов и стоимость |
| `schema-sanitizer/` | schema-sanitizer | Чинит HTTP 400 `invalid_json_schema` от OpenAI-совместимых гейтвеев на RE2/Go: переписывает lookaround-ассерты и `\uXXXX`-эскейпы в исходниках regex-паттернов исходящих tool-схем, сохраняя семантику матчинга |
| `pi-custom-providers/` | pi-custom-providers | Регистрирует кастомных провайдеров `gonka` и `opencode-go` (ключи через env `GONKA_API_KEY` / `OPENCODE_GO_API_KEY`) |

## Установка

Клонировать репозиторий в `~/.pi/agent/extensions/` — манифест `package.json` (поле `pi.extensions`) объявляет все расширения из таблицы выше, и Pi подхватит их автоматически при старте или `/reload`. Копировать каталоги по одному и прописывать пути в `settings.json` не нужно.

```bash
git clone https://github.com/svetlovtech/pi-local-extensions.git ~/.pi/agent/extensions/svetlovtech-pi-local-extensions
```

Альтернатива для кастомных путей — указать путь к репозиторию в `settings.json` → `packages`.

## Конфигурация pi-footer

Актуальный конфиг футера хранится в этом репозитории: [`pi-footer.json`](pi-footer.json). Живая копия лежит в `~/.pi/agent/extensions/pi-footer.json` — при изменении не забывайте синхронизировать обе стороны.

## Кастомные провайдеры

`pi-custom-providers` регистрирует двух провайдеров:

- `gonka` — Gonka Router API (`https://api.gonkarouter.io/v1`), ключ из env `GONKA_API_KEY`
- `opencode-go` — Opencode GO API (`https://api.opencode.com/v1`), ключ из env `OPENCODE_GO_API_KEY`

Без установленного env-ключа провайдер просто недоступен для выбора модели.

## Отображение в pi-footer

Расширения публикуют статусы через `ctx.ui.setStatus()`. В `~/.pi/agent/extensions/pi-footer.json` (копия — [`pi-footer.json`](pi-footer.json)) они выводятся виджетами `external-status`:

- `mcp-count` → `{ "type": "external-status", "externalStatusKey": "mcp-count", "raw": true }`
- `ctx` / `cache` → `{ "type": "external-status", "externalStatusKey": "ctx" }` / `"cache"`
- `active-time` → `{ "type": "external-status", "externalStatusKey": "active-time", "raw": true }`

Итого вторая строка футера показывает: total wall-clock время сессии (встроенный виджет `total-time` pi-footer) и фактическое время работы агента (`act`).

## Зависимости

- peerDependency: `@earendil-works/pi-coding-agent` (`*`)
- Конфигурации не требуют; пороги цветов в `ctx-cache-colors` захардкожены (50/70/80/90 %)
