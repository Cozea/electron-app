# Desktop typography

The Tailwind theme in `apps/desktop/src/index.css` defines the desktop text scale:

| Utility | Size | Line height |
| --- | --- | --- |
| `text-2xs` | 10px | 14px |
| `text-xs` | 12px | 16px |
| `text-sm` | 13px | 20px |
| `text-base` | 14px | 20px |
| `text-lg` | 16px | 24px |
| `text-xl` | 18px | 26px |

Body copy, sidebar navigation, workbench tab titles, and launcher labels use the
13px scale. Secondary copy uses 12px; compact counters use 10px. Settings page
titles use 22px. There is no global `!important` rule normalizing text utilities.
The composer sets its line height explicitly from `--composer-line-height` so
editable text and its placeholder retain the same line geometry.

Shared search fields are 36px high. Settings omit page subtitles and the profile
footer; DevApp Settings places search above the filter chips. The workbench
launcher uses the shared fading horizontal scroll area for category chips.

These presentation changes were integrated from `perf/navigation-runtime-v2` at
`deb92d01`. Navigation and persistence continue to use the repaired implementation
from `aa9e3712`, including its production-path validation and regression tests.
The earlier branch's competing presentation modules were not restored. Existing
performance scripts and marks remain available; automatic jank logging and
optional LegendList debug callbacks were removed.
