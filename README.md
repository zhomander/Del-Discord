# Del-Discord — Installation guide

[![Version: v1.0.0][version-badge]][script]
[![License: MIT][license-badge]][license]
[![Discord website][platform-badge]][discord]

**Install Del-Discord in your browser to access message cleanup and DM history.**

[**Get the userscript**][script] · [Greasy Fork][greasyfork] *(not published yet)* · [Installation help](#installation-help)

> [!WARNING]
> Del-Discord automates actions on your user account. Discord prohibits this type of automation (self-bots), and using it may result in account suspension or termination. Randomized delays do not guarantee protection from detection. Read [Discord’s self-bot policy](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots) before installing. Use at your own risk.

---

## Install Del-Discord

### 1. Install a userscript manager

Skip this step if you already have one installed.

| Browser | Userscript manager |
| :--- | :--- |
| Chrome / Brave | [Tampermonkey][tampermonkey] or [Violentmonkey][violentmonkey] |
| Firefox | [Greasemonkey][greasemonkey], [Tampermonkey][tampermonkey], or [Violentmonkey][violentmonkey] |
| Edge | [Tampermonkey][tampermonkey] |

### 2. Get the script

[![Get Del-Discord v1][install-badge]][script]

Open **[Del-Discord-v1.user.js][script]** and copy the complete script. If viewing it on GitHub, select <kbd>Raw</kbd> first.

> **Greasy Fork:** Del-Discord has not been published on [Greasy Fork][greasyfork] yet. Use the included script for now.

### 3. Save it in your manager

Open your userscript manager and select <kbd>Create a new script</kbd>. Replace the default contents with Del-Discord, then <kbd>Save</kbd> and enable it.

If your browser asks, allow the extension to run userscripts and access Discord.

### 4. Disable overlapping scripts

Disable other Discord cleanup or DM history scripts if installed.

### 5. Open Discord

Open **[Discord][discord] in your browser**, refresh, and enter a DM or channel. This installation supports the Discord website; the desktop app is not supported.

### 6. Check the toolbar

Look for the <kbd>🗑️</kbd> button in the channel header. Open it to access Messages, Reactions, Queue, and DM History in one window.

**Installing Del-Discord does not delete or overwrite messages.**

---

## Installation help

| If… | Try… |
| :--- | :--- |
| The buttons do not appear | Enable the manager and Del-Discord, allow access to Discord, then refresh. |
| Your browser blocks userscripts | Enable the extension's userscript permission when prompted. |
| Duplicate buttons appear | Disable overlapping Discord scripts, then refresh. |
| You want to update | Replace the installed script with the new complete userscript and save. |

Still having installation trouble? [Open an installation bug report][bug-report]. Include your browser, manager, and script version; leave account tokens and private messages out of reports.

---

[version-badge]: https://img.shields.io/badge/version-v1.0.0-5865F2?style=flat-square
[license-badge]: https://img.shields.io/badge/license-MIT-22C55E?style=flat-square
[platform-badge]: https://img.shields.io/badge/platform-Discord%20website-5865F2?style=flat-square
[install-badge]: https://img.shields.io/badge/Get_Del--Discord-v1.0.0-5865F2?style=for-the-badge
[script]: ./dist/Del-Discord-v1.user.js
[license]: ./LICENSE
[discord]: https://discord.com/channels/@me
[greasyfork]: https://greasyfork.org/
[tampermonkey]: https://www.tampermonkey.net/
[violentmonkey]: https://violentmonkey.github.io/
[greasemonkey]: https://addons.mozilla.org/firefox/addon/greasemonkey/
[bug-report]: https://github.com/zhomander/del-discord/issues/new?template=bugreport.yml
