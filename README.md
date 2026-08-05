# Напоминания

Персональное Windows-приложение на Electron, Vue 3 и TypeScript. Показывает постоянные
напоминания, поддерживает повторения и запускается вместе с Windows.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Данные пользователя

Напоминания хранятся отдельно от файлов программы:

```text
%APPDATA%\reminder-app\data\reminders.json
```

Последние десять состояний автоматически сохраняются в папке `data\backups`. Обновление или
переустановка приложения не удаляет эти файлы. Приложение следует запускать от обычного
пользователя, без прав администратора.

При первом запуске версии `1.2.0` существующие напоминания автоматически переносятся из
`localStorage` в файловое хранилище.

## Выпуск новой версии

1. Обновить версию в `package.json` и `package-lock.json`.
2. Выполнить `npm run typecheck`, `npm run lint` и `npm run build`.
3. Закоммитить и отправить изменения в ветку `main`.
4. Создать и отправить тег, совпадающий с версией:

```bash
git tag v1.2.0
git push origin v1.2.0
```

GitHub Actions соберёт Windows-установщик и опубликует Release. Установленные версии приложения
проверяют обновления через GitHub Releases.
