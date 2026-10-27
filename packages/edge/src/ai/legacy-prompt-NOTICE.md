# Legacy prompt data

`legacy-prompt-sources.json` contains the historical English CSV and Chinese JSON
catalog shipped as `app-resources/prompts/prompts-en.csv` and `prompts-zh.json` in
DK-Suite 0.4.95. It contains prompt text only. No recovered program code executes.

The English data is from f/awesome-chatgpt-prompts, whose prompt dataset is CC0.
https://github.com/f/awesome-chatgpt-prompts/blob/main/LICENSE
The Chinese translation is from PlexPt/awesome-chatgpt-prompts-zh, MIT licensed.
https://github.com/PlexPt/awesome-chatgpt-prompts-zh/blob/main/LICENSE
The upstream licenses were checked on 2026-10-26. The Chinese notice follows.

Decision 12 removes only jailbreak and NSFW entries. Source positions remain stable:
English indices 61 and 151, Chinese indices 61, 118, 120 and 121. Their text is
replaced with placeholders, and the loader excludes those positions. All remaining
166 English and 120 Chinese entries retain their original order and prompt text.
The application prepends its own empty Default entry. English uses the CSV;
all other historical locales use the Chinese fallback.

MIT License

Copyright (c) 2025 plex

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
