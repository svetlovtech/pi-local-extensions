# pi-local-extensions

Наши локальные расширения для Pi-агента (без upstream, разработаны под себя).

| Каталог | Расширение | Что делает |
|---|---|---|
| `mcp-count/` | mcp-count | Считает включённые MCP-серверы из `~/.pi/agent/mcp.json`, публикует статус `mcp-count` (`MCP: N`) для pi-footer |
| `ctx-cache-colors/` | ctx-cache-colors | 5-зонная цветовая индикация (ANSI 256) заполнения контекста (`ctx`) и cache hit rate (`cache`): чем хуже — тем «краснее» |
| `active-time/` | active-time | Аккумулирует фактическое время работы агента (сумма отрезков `agent_start`→`agent_end`), публикует статус `active-time` (`act 4m 12s`) для pi-footer. Переживает перезапуск сессии через `appendEntry` |

## Установка

Скопировать каталог расширения в `~/.pi/agent/extensions/` (или указать путь в `settings.json` → `packages` как `extensions/<name>`), затем перезапустить Pi.

Пример для settings.json:

```json
{
  "packages": [
    "extensions/mcp-count",
    "extensions/ctx-cache-colors"
  ]
}
```

## Отображение в pi-footer

Оба расширения публикуют статусы через `ctx.ui.setStatus()`. В `~/.pi/agent/extensions/pi-footer.json` они выводятся виджетами `external-status`:

- `mcp-count` → `{ "type": "external-status", "externalStatusKey": "mcp-count", "raw": true }`
- `ctx` / `cache` → `{ "type": "external-status", "externalStatusKey": "ctx" }` / `"cache"`
- `active-time` → `{ "type": "external-status", "externalStatusKey": "active-time", "raw": true }`

Итого вторая строка футера показывает: total wall-clock время сессии (встроенный виджет `total-time` pi-footer) и фактическое время работы агента (`act`).

## Зависимости

- peerDependency: `@earendil-works/pi-coding-agent` (`*`)
- Конфигурации не требуют; пороги цветов в `ctx-cache-colors` захардкожены (50/70/80/90 %)
