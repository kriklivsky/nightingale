const en = {
  pageTitle: 'Laptop screen — Orange Pi',
  eyebrow: 'ORANGE PI · LOCAL SCREEN SHARING',
  heading: 'Laptop screen on the TV',
  intro:
    'Video and audio travel over your network. The microphones stay connected to the Orange Pi.',
  unsupported:
    'Screen capture is unavailable. Open this page in Chrome over HTTPS and trust the Orange Pi certificate after comparing its fingerprint with the one on the TV. Do not disable browser security.',
  codeLabel: 'Enter the code shown on the TV',
  connect: 'Connect',
  connecting: 'Connecting…',
  paired: 'Connected. Choose what to show on the TV.',
  quality: 'Quality',
  chooseScreen: 'Choose a screen or tab',
  sharing: 'Sharing',
  disconnect: 'Disconnect',
  note4k:
    '4K needs a source of matching resolution. Frame rate depends on the network and devices.',
  noteAudio:
    'For music and video, choose a Chrome tab and enable “Share tab audio”. With the whole screen, system audio depends on the OS and browser.',
  notePrivacy:
    'The receiver never asks for the laptop microphone, does not record the stream, and uses no external STUN/TURN servers. Both devices must be on the same reachable network.',
  quality1080p30: '1080p · 30 fps',
  quality4k30: '4K · 30 fps',
  quality4k60: '4K · up to 60 fps',
  genericError: 'Could not connect the laptop screen.',
  httpError: (status: number) => `Connection error: HTTP ${status}`,
  noSdp: 'The browser did not prepare connection parameters.',
  noRoute: 'Could not find a network route. Check the local network.',
  noWebrtc: 'This browser has no WebRTC. Check the receiver installation.',
  sharingSilent:
    'The screen is shared without audio. For audio, choose a tab and enable “Share tab audio”.',
  sharingWithAudio: 'Screen and audio are shared to the TV.',
  directFailed:
    'Could not establish a direct connection. Check the network and Wi-Fi client isolation.',
  connectingTv: 'Connecting the TV…',
  microphones: 'Orange Pi microphones',
  monitoring: (on: boolean) => `Speaker monitoring: ${on ? 'on' : 'off'}`,
  monitoringHint:
    'With the UMC202HD hardware Direct Monitor, turn software monitoring off to avoid hearing a delayed copy of your voice. Stream audio and the Python feed stay on.',
  allowPython: 'Allow the stream for Python',
  revokeAccess: 'Revoke microphone access',
  micUnavailable: 'UMC202HD is unavailable on the Orange Pi.',
  micStreaming: 'Both inputs stream to the laptop: 48 kHz, PCM S16LE, channels 1 and 2.',
  micNotStreaming: 'Microphones are not streamed to the laptop.',
  sessionClosed: 'The connection is closed. Enter the TV code again.',
  keyCopied: 'Key copied. Paste it into the hidden prompt of the Python client.',
  copyKey: 'Copy temporary key',
  downloadClient: 'Download the Python client',
  downloadCertificate: 'Download the public certificate',
  clientHint:
    'On the laptop run microphone_client.py from tools/tvbox and paste the key when asked. Keep this page open; disconnecting or revoking access stops the stream. The browser neither plays nor records the microphones.',
};

type ScreenMessages = typeof en;

const ru: ScreenMessages = {
  pageTitle: 'Экран ноутбука — Orange Pi',
  eyebrow: 'ORANGE PI · ЛОКАЛЬНАЯ ТРАНСЛЯЦИЯ',
  heading: 'Экран ноутбука на телевизоре',
  intro: 'Видео и звук передаются по вашей сети. Микрофоны остаются подключёнными к Orange Pi.',
  unsupported:
    'Захват экрана недоступен. Откройте эту страницу в Chrome по HTTPS и доверьте сертификат Orange Pi, сверив его отпечаток с телевизором. Не отключайте защиту браузера.',
  codeLabel: 'Введите код с телевизора',
  connect: 'Подключиться',
  connecting: 'Подключаемся…',
  paired: 'Подключено. Выберите, что показать на телевизоре.',
  quality: 'Качество',
  chooseScreen: 'Выбрать экран или вкладку',
  sharing: 'Трансляция запущена',
  disconnect: 'Отключиться',
  note4k:
    '4K требует источника соответствующего разрешения. Частота кадров зависит от сети и производительности устройств.',
  noteAudio:
    'Для музыки и видео выбирайте вкладку Chrome и включайте «Передавать звук». При выборе всего экрана наличие системного звука зависит от ОС и браузера.',
  notePrivacy:
    'Приёмник не запрашивает доступ к микрофону ноутбука, не записывает трансляцию и не использует внешние STUN/TURN-серверы. Устройства должны быть в одной доступной сети.',
  quality1080p30: '1080p · 30 кадров/с',
  quality4k30: '4K · 30 кадров/с',
  quality4k60: '4K · до 60 кадров/с',
  genericError: 'Не удалось подключить экран ноутбука.',
  httpError: (status: number) => `Ошибка подключения: HTTP ${status}`,
  noSdp: 'Браузер не подготовил параметры соединения.',
  noRoute: 'Не удалось найти сетевой маршрут. Проверьте локальную сеть.',
  noWebrtc: 'В этом браузере нет WebRTC. Проверьте установку приёмника.',
  sharingSilent:
    'Экран передаётся без звука. Для звука выберите вкладку и включите «Передавать звук».',
  sharingWithAudio: 'Экран и звук передаются на телевизор.',
  directFailed: 'Не удалось установить прямую связь. Проверьте сеть и изоляцию Wi-Fi клиентов.',
  connectingTv: 'Подключаем телевизор…',
  microphones: 'Микрофоны Orange Pi',
  monitoring: (on: boolean) => `Мониторинг в колонках: ${on ? 'вкл' : 'выкл'}`,
  monitoringHint:
    'С аппаратным Direct Monitor на UMC202HD выключите программный мониторинг, чтобы не слышать задержанную копию голоса. Звук трансляции и поток для Python не выключаются.',
  allowPython: 'Разрешить поток для Python',
  revokeAccess: 'Отозвать доступ к микрофонам',
  micUnavailable: 'UMC202HD недоступен на Orange Pi.',
  micStreaming: 'Два входа передаются на ноутбук: 48 кГц, PCM S16LE, каналы 1 и 2.',
  micNotStreaming: 'Микрофоны на ноутбук не передаются.',
  sessionClosed: 'Подключение закрыто. Введите код с телевизора заново.',
  keyCopied: 'Ключ скопирован. Вставьте его в скрытый запрос Python-клиента.',
  copyKey: 'Скопировать временный ключ',
  downloadClient: 'Скачать Python-клиент',
  downloadCertificate: 'Скачать публичный сертификат',
  clientHint:
    'На ноутбуке запустите microphone_client.py из tools/tvbox, вставьте ключ по запросу. Оставьте эту страницу открытой; отключение или отзыв доступа останавливают поток. Микрофоны не воспроизводятся и не записываются браузером.',
};

const prefersRussian = navigator.languages.some((language) =>
  language.toLowerCase().startsWith('ru'),
);

/** Sender copy in the laptop browser's language (Russian or English). */
export const messages: ScreenMessages = prefersRussian ? ru : en;

export const documentLanguage = prefersRussian ? 'ru' : 'en';
