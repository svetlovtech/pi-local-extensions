# pi-local-extensions

Наши локальные расширения для Pi-агента (без upstream, разработаны под себя).

| Каталог | Расширение | Что делает |
|---|---|---|
| `mcp-count/` | mcp-count | Считает включённые MCP-серверы из `~/.pi/agent/mcp.json`, публикует статус `mcp-count` (`MCP: N`) для pi-footer |
| `ctx-cache-colors/` | ctx-cache-colors | 5-зонная цветовая индикация (ANSI 256) заполнения контекста (`ctx`) и cache hit rate (`cache`): чем хуже — тем «краснее» |
| `active-time/` | active-time | Аккумулирует фактическое время работы агента (сумма отрезков `agent_start`→`agent_end`), публикует статус `active-time` (`act 4m 12s`) для pi-footer. Переживает перезапуск сессии через `appendEntry` |

## Установка

Клонировать репозиторий в `~/.pi/agent/extensions/` — манифест `package.json` (поле `pi.extensions`) объявляет все три расширения, и Pi подхватит их автоматически при старте или `/reload`. Копировать каталоги по одному и прописывать пути в `settings.json` не нужно.

```bash
git clone https://github.com/svetlovtech/pi-local-extensions.git ~/.pi/agent/extensions/svetlovtech-pi-local-extensions
```

Альтернатива для кастомных путей — указать путь к репозиторию в `settings.json` → `packages`.

## Конфигурация pi-footer

Актуальный конфиг футера хранится в этом репозитории: [`pi-footer.json`](pi-footer.json). Живая копия лежит в `~/.pi/agent/extensions/pi-footer.json` — при изменении не забывайте синхронизировать обе стороны.

## Отображение в pi-footer

Оба расширения публикуют статусы через `ctx.ui.setStatus()`. В `~/.pi/agent/extensions/pi-footer.json` (копия — [`pi-footer.json`](pi-footer.json)) они выводятся виджетами `external-status`:

- `mcp-count` → `{ "type": "external-status", "externalStatusKey": "mcp-count", "raw": true }`
- `ctx` / `cache` → `{ "type": "external-status", "externalStatusKey": "ctx" }` / `"cache"`
- `active-time` → `{ "type": "external-status", "externalStatusKey": "active-time", "raw": true }`

Итого вторая строка футера показывает: total wall-clock время сессии (встроенный виджет `total-time` pi-footer) и фактическое время работы агента (`act`).

## Зависимости

- peerDependency: `@earendil-works/pi-coding-agent` (`*`)
- Конфигурации не требуют; пороги цветов в `ctx-cache-colors` захардкожены (50/70/80/90 %)
