# Orange Pi 5 «караоке-ТВ-бокс» — руководство по восстановлению на чистую систему

Документ собран из codex-сессии `01a09123-733c-7401-bf5f-3537a5f1746d` («Добавить поддержку Orange Pi 5», 11.09–21.10.2026) и репозитория `~/git/nightingale`.
Назначение: по шагам восстановить всё состояние прошивки **Orange Pi 5** на новом носителе/плате. Сам код приложения — в форке Nightingale (`~/git/nightingale`, ветка TV-box форка, база v1.3.0); здесь описывается только **системная часть**, которой нет в репо.

> Рабочая машина разработчика: `10.3.0.80`, доступ к боксу по SSH `root@10.3.0.102` (публичный ключ).
> **Диск старого бокса умер.** Восстановление = чистая установка + шаги ниже + данные из бэкапов (см. §16).

---

## 1. Железо и обвязка

| Компонент | Значение |
|---|---|
| Плата | Orange Pi 5 (RK3588S, 8 GB RAM, FDT `rockchip/rk3588s-orangepi-5.dtb`) |
| Носитель | NVMe SSD (`nvme0n1`, ext4, root=UUID) — **это он и умер** |
| Видео | HDMI → саундбар **LG S95TR** (вход HDMI IN) → ТВ **LG OLED G5**; eARC между ТВ и саундбаром |
| Аудио | USB-интерфейс **Behringer UMC202HD** (ALSA-карта `U192k`): 2 микрофона XLine MD-272A на входах, активные колонки на OUTPUT 1/2, физ. тумблер DIRECT MONITOR |
| Сеть | Ethernet `end1` (r8169), статический адрес **10.3.0.102/24** (DHCP-резервация по MAC на роутере; MAC старого бокса в логах то `c8:9d:ff:a1:63:0e`, то `ca:9d:00:a1:63:0e` — на новой плате MAC свой, резервацию обновить). Wi-Fi USB-адаптер **Realtek RTL8821CU** (после modeswitch `0bda:1a2b` → `0bda:c811`, драйвер `rtl8821cu` в ядре) |
| Статичные адреса | IP бокса жёстко прописан в `songs-web.yaml`, `tvbox-novnc` (bind) и TLS-сертификатах (SAN). Менять IP = перегенерировать сертификаты и конфиги |

## 2. Базовая система

- **Armbian 26.8.3 (Debian 13 trixie), vendor-образ Orange Pi 5**, ядро `6.1.115-vendor-rk35xx` (`Linux orangepi5 6.1.115-vendor-rk35xx #1 SMP ... aarch64`). Ставится любой свежий Armbian-образ для Orange Pi 5 с vendor-веткой rk35xx (ядро серии 6.1 — важно: в нём rknpu v0.9.8, dwhdmi CEC, panthor).
- Hostname: `orangepi5`.
- `/boot/armbianEnv.txt`: `overlay_prefix=rockchip-rk3588`, `fdtfile=rockchip/rk3588s-orangepi-5.dtb`, `extraargs=cma=256M`. Для GPU по умолчанию пантора может требовать overlay `rockchip-rk3588-panthor-gpu.dtbo` (в старой системе был эксперимент `armbianEnv.txt.panthor`); проверить после установки: `glxinfo | grep "OpenGL version"` — ожидается ~3.1 (glamor over panthor), не llvmpipe.
- root-доступ: только SSH по ключу (парольный вход не требовался). Добавить публичный ключ рабочей машины в `/root/.ssh/authorized_keys`.
- Свежий Armbian по умолчанию включает zram (~4 GiB swap) и `armbian-ramlog` — оставить как есть.

## 3. Пакеты (apt)

```sh
apt update
apt install -y --no-install-recommends \
  xserver-xorg-core xserver-xorg-video-all x11-utils x11-xserver-utils xdotool xauth \
  xvfb dbus-x11 python3-evdev \
  x11vnc novnc websockify \
  v4l-utils evtest cec-utils \
  picom rtkit avahi-daemon avahi-utils \
  network-manager dnsmasq-base nftables usb-modeswitch usb-modeswitch-data \
  ffmpeg gdb strace tcpdump time
# тулчейн сборки на борту (Nightingale собирается на самом боксе)
apt install -y build-essential cmake ninja-build meson pkg-config git \
  libdrm-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev \
  librsvg2-dev libxdo-dev libasound2-dev patchelf xdg-utils nodejs
apt install -y -t trixie-backports rustc cargo rustfmt rust-clippy   # rust 1.94.x
apt install -y --no-install-recommends \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav \
  gstreamer1.0-gl gstreamer1.0-alsa gstreamer1.0-gtk3 gstreamer1.0-nice \
  gir1.2-gstreamer-1.0 gir1.2-gst-plugins-base-1.0 gir1.2-gst-plugins-bad-1.0 \
  gir1.2-webkit2-4.1 python3-aiohttp python3-gi python3-gst-1.0 python3-numpy
# moonlight build deps:
apt install -y git ninja-build libdrm-dev libopus-dev libevdev-dev libudev-dev \
  libcurl4-openssl-dev libsdl2-dev libavcodec-dev libavutil-dev libavahi-client-dev
```
(Список из фактических установок сессии; точный минимум по зависимостям доставляется apt автоматически.)
Менеджер пакетов Python на борту — `uv` (ставится скриптом Nightingale-вендора или вручную: `curl -LsSf https://astral.sh/uv/install.sh | sh`).

## 4. Пользователь и каталоги

```sh
useradd --system --home-dir /var/lib/tvbox --create-home --shell /usr/sbin/nologin \
  --groups audio,video,render,input tvbox
install -d -m 0755 -o tvbox -g tvbox /var/lib/tvbox /var/lib/tvbox/songs /var/lib/tvbox/.nightingale/models
install -d -m 0755 /etc/tvbox /usr/local/libexec /usr/local/share/tvbox-screen /usr/local/libexec/tvbox-network /usr/local/libexec/tvbox-screen
```
Каталоги назначения:
- `/var/lib/tvbox` — HOME пользователя `tvbox` (uid 987), от него работает вся TV-сессия;
- `/var/lib/tvbox/songs` — медиатека (права `tvbox:tvbox 775`);
- `/var/lib/tvbox/.nightingale` — данные Nightingale: `songs.db`, кэш анализов, `models/`, `vendor/` (python-вендор), `remote-control.json`, сертификаты/настройки экранного шэринга (`~/.config/tvbox-screen/`);
- `/etc/tvbox` — `moonlight.conf`, `novnc.{pass,crt,key}`, `songs-web.{yaml,crt,key}`;
- `/run/tvbox.Xauthority`, `/run/tvbox-active.{pid,kind}` — рантайм-файлы сессии.

## 5. udev-правила `/etc/udev/rules.d/99-tvbox.rules`

```udev
KERNEL=="mpp_service", SUBSYSTEM=="mpp_class", GROUP="video", MODE="0660"
SUBSYSTEM=="dma_heap", KERNEL=="system|system-uncached", GROUP="video", MODE="0660"
KERNEL=="uinput", GROUP="input", MODE="0660"
```
После установки: `udevadm control --reload-rules && udevadm trigger`.
Проверка: `/dev/mpp_service` и `/dev/dma_heap/*` группа `video`, `/dev/uinput` группа `input`, `/dev/cec0` доступен (группа `video`).

## 6. Исходники тв-бокса

Весь код компонентов бокса — в форке: `~/git/nightingale/tools/tvbox/` (скрипты `tvbox-session`, `tvbox-cec.py`, `tvbox-launcher.c`, `tvbox-audio`, сеть/Wi-Fi `tvbox-network*`, экран `tvbox-screen*`, утилиты `tvbox-retry-failed`, `tvbox-clean-failed`, `tvbox-fix-song-permissions`, конфиги `90-tvbox-wifi.conf`, `91-tvbox-keyboard.conf`, `moonlight.conf`, README с командами установки) и `~/git/nightingale/tools/rknn/` (скрипты конвертации UVR-модели в RKNN).
**В репо нет** (воссоздать из этого документа): `tvbox-session.service`, `tvbox-cec.service`, `tvbox-vnc.service`, `tvbox-novnc.service`, `tvbox-songs-web.service`, `/etc/tvbox/songs-web.yaml`, `99-tvbox.rules`, xorg-конфы, `.asoundrc`. Их содержимое ниже.

Развертывание (как делалось): `rsync/scp` нужных файлов в `/var/tmp/tvbox-deploy/`, проверка (`bash -n`, `python3 -m py_compile`), затем `install` на места. Сборка лаунчера на борту:

```sh
gcc -std=c11 -O2 -Wall -Wextra -Werror -pedantic tools/tvbox/tvbox-launcher.c -o tvbox-launcher $(pkg-config --cflags --libs gtk+-3.0)
sudo install -m 0755 tvbox-launcher /usr/local/bin/tvbox-launcher
```

## 7. X11-сессия `tvbox-session.service`

`/etc/systemd/system/tvbox-session.service`:
```ini
[Unit]
Description=Orange Pi TV fullscreen launcher session
After=systemd-user-sessions.service getty@tty1.service
Conflicts=getty@tty1.service

[Service]
Type=simple
ExecStart=/usr/local/libexec/tvbox-session
Restart=always
RestartSec=2
TTYPath=/dev/tty1
StandardInput=tty-force
StandardOutput=journal
StandardError=journal
KillMode=mixed
TimeoutStopSec=12
OOMPolicy=continue        # (в старой системе — отдельный drop-in tvbox-session-oom.conf)

[Install]
WantedBy=multi-user.target
```
`/usr/local/libexec/tvbox-session` — скрипт из `tools/tvbox/tvbox-session` (в репо, актуальная версия). Логика:
- запуск `Xorg :0 vt1 -keeptty -noreset -nolisten tcp` с XAUTHORITY `/run/tvbox.Xauthority` (uid tvbox); если HDMI-коннектор `card0-HDMI-A-1` не `connected` — fallback `Xvfb :0 1920x1080x24` (для VNC-доступа без ТВ);
- `xset s off / s noblank / -dpms`; `configure_4k_mode` — `xrandr --output HDMI-A-1 --mode 3840x2160 --rate 60` по EDID;
- композитор `picom --config /dev/null --backend xrender --vsync` (**XRender обязательно**: GLX пикому нужен GL 3.3, бокс даёт 3.1);
- мониторинг hotplug HDMI и перезапуск, запуск launcher/Nightingale/Moonlight от пользователя `tvbox` с env:
  `NIGHTINGALE_DATA_PATH=/var/lib/tvbox/.nightingale`, `NIGHTINGALE_UVR_BACKEND=auto`, `NIGHTINGALE_RKNN_CORE=all`, `NIGHTINGALE_RKNN_STREAM_COMPONENTS=1`, `NIGHTINGALE_RKNN_PARALLEL_CORES=1`;
- при запуске Moonlight Xorg должен освободить DRM master (в скрипте).
Для экрана WebKit-клипсов в env сессии должен быть `GST_PLUGIN_PATH=/usr/local/lib/aarch64-linux-gnu/gstreamer-1.0` (см. §9; в текущем `tvbox-session` из репо проверить/добавить).

X-конфы `/etc/X11/xorg.conf.d/`:
- `01-armbian-defaults.conf` — конфиг Armbian по умолчанию (modesetting + glamor, `Option "kmsdev" "/dev/dri/card0"`);
- `20-tvbox-safe.conf` — страховка (Device/Screen секция; исторически `AccelMethod "none"` при диагностике, финально glamor):
```
Section "Device"
    Identifier "Rockchip"
    Driver "modesetting"
    Option "kmsdev" "/dev/dri/card0"
    Option "AccelMethod" "glamor"
EndSection
```
- `30-tvbox-cec-input.conf`:
```
Section "InputClass"
    Identifier "TV box CEC virtual keyboard"
    MatchProduct "tvbox-cec-keyboard"
    Driver "libinput"
EndSection
```
- `91-tvbox-keyboard.conf` (из репо) — раскладки `us,ru`, Alt+Shift.

## 8. HDMI-CEC: пульт как клавиатура — `tvbox-cec.service`

Архитектура: пульт ТВ → CEC `/dev/cec0` (драйвер `dwhdmi-rockchip`, адаптер `dw_hdmi_qp`) → демон `tvbox-cec.py` (python-evdev, работает с v4l2-cec без libcec) → виртуальная клавиатура uinput `tvbox-cec-keyboard` (стрелки/OK/Back → KEY_UP/DOWN/LEFT/RIGHT/ENTER/BACK; удержание Back → `tvbox-return`). Отдельный raw-input `dw_hdmi_qp` от rc-мэппинга ядра в X не используется.

`/etc/systemd/system/tvbox-cec.service`:
```ini
[Unit]
Description=Orange Pi TV HDMI-CEC to uinput bridge
After=systemd-udev-settle.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/libexec/tvbox-cec.py
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX

[Install]
WantedBy=multi-user.target
```
Скрипт — `tools/tvbox/tvbox-cec.py` из репо (финальная версия содержит: восстановление активного источника при старте и при смене входа — `Image View On` + отдельный `Active Source`, один раз на старт сервиса, с блокировкой/throttle; обычные клавиши пульта пробуждение НЕ триггерят).
Пакеты: `v4l-utils` (cec-ctl), `python3-evdev`.
Проверка: `cec-ctl --list-devices`, `evtest` на имени `tvbox-cec-keyboard`.

## 9. Аппаратурное декодирование видео: Rockchip MPP + gst mppvideodec

```sh
sudo apt-get install --no-install-recommends cmake ninja-build meson pkg-config libdrm-dev \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev
git clone --depth 1 -b develop https://github.com/rockchip-linux/mpp.git /var/tmp/tvbox-build/mpp
cmake -S /var/tmp/tvbox-build/mpp -B /var/tmp/tvbox-build/mpp-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local -DBUILD_TEST=OFF
sudo ninja -C /var/tmp/tvbox-build/mpp-build install && sudo ldconfig
git clone --depth 1 -b gstreamer-rockchip https://github.com/JeffyCN/mirrors.git gst-rockchip
PKG_CONFIG_PATH=/usr/local/lib/pkgconfig meson setup gst-rockchip/build gst-rockchip \
  --prefix=/usr/local --buildtype=release -Drockchipmpp=enabled -Drga=disabled \
  -Dkmssrc=disabled -Dvpxalphadec=disabled -Drkximage=disabled
sudo ninja -C gst-rockchip/build install
```
Проверка: `GST_PLUGIN_PATH=/usr/local/lib/aarch64-linux-gnu/gstreamer-1.0 gst-inspect-1.0 mppvideodec`.
Нужно WebKit-видео (YouTube-клипы) и экранному шэрингу (аппаратный H.264/H.265/VP9/AV1 decode).

## 10. NPU / RKNN runtime

- Драйвер NPU — из vendor-ядра (`/sys/kernel/debug/rknpu/version` → `RKNPU driver: v0.9.8`); устройств `renderD129` достаточно с группой `render` (tvbox в ней).
- Runtime: скачать `librknnrt.so` v**2.3.2** из релизов `airockchip/rknn-toolkit2` → `/usr/lib/librknnrt.so`, `ldconfig`.
- Python `rknn-toolkit-lite2==2.3.2` (wheel cp311 aarch64, из `rknpu2` релизов) — ставится в **vendor-venv Nightingale** (`/var/lib/tvbox/.nightingale/vendor/venv`, Python 3.11 от uv; Nightingale сам поднимает vendor-окружение при первом запуске — установить wheel туда же).
- UVR-модель для NPU: каталог `/var/lib/tvbox/.nightingale/models/mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.rk3588.fp16` (несколько сегментов .rknn). Конвертируется НЕ на боксе: `tools/rknn/README.md` → `export_uvr_onnx.py` + `convert_uvr.py` (x86-машина, python 3.11 venv, `rknn-toolkit2==2.3.2`), результат закинуть в models/.
- Проверка: `cat /sys/kernel/debug/rknpu/load` показывает 3 ядра (Core0..2) во время анализа; env `NIGHTINGALE_RKNN_CORE=all` (в tvbox-session).

## 11. Moonlight (клиент GameStream/Sunshine)

Собирается **moonlight-embedded** из исходников с поддержкой Rockchip MPP (устанавливает `libmoonlight-rk.so`, `libgamestream.so` в /usr/local):
```sh
git clone --depth 1 https://github.com/moonlight-stream/moonlight-embedded.git /var/tmp/tvbox-build/moonlight-embedded
cmake -S /var/tmp/tvbox-build/moonlight-embedded -B /var/tmp/tvbox-build/moonlight-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --install /var/tmp/tvbox-build/moonlight-build && sudo ldconfig
```
Версия в старой системе: `Moonlight Embedded 2.7.1 (v2.7.1-7754442)`.
Конфиг `/etc/tvbox/moonlight.conf` — это `tools/tvbox/moonlight.conf` из репо:
```
width=3840 height=2160 fps=60 bitrate=80000 packetsize=1392 codec=h265
app=Desktop mapping=gamecontrollerdb.txt quitappafter=true audio=default platform=rk remote=auto
```
(`audio = default` — чтобы работал селектор HDMI/UMC; `codec` финально h265 — AV1 на RK3588 умеется, но конфиг зафиксирован на h265.)
Пейринг с хостом (Sunshine/Apollo на ПК) — через лаунчер (`moonlight pair -config /etc/tvbox/moonlight.conf -pin <PIN> <host>`), выбранный хост хранится в `/var/lib/tvbox/.config/moonlight/selected-host`; клиентский сертификат — в `~/.local/share/moonlight` пользователя tvbox. **На новой плате — перепариться.**

## 12. ALSA / аудио

PulseAudio/PipeWire **нет** — чистый ALSA. Файл `/var/lib/tvbox/.asoundrc` (владелец tvbox), финальная низколатентная версия (HDMI-выход):
```
pcm.tvbox_hdmi_mix {
    type dmix
    ipc_key 20260923
    ipc_key_add_uid true
    slave {
        pcm "hw:CARD=rockchiphdmi0,DEV=0"
        rate 48000
        format S32_LE
        channels 2
        period_time 0
        period_size 256
        buffer_size 1024
    }
}
pcm.!default {
    type plug
    slave.pcm "tvbox_hdmi_mix"
}
ctl.!default {
    type hw
    card rockchiphdmi0
}
```
- `tvbox-audio` (репо, `/usr/local/bin/tvbox-audio`) переключает default-роут между `rockchiphdmi0` (саундбар) и `U192k` (UMC202HD, колонки), хранит выбор и переписывает `.asoundrc` (оригинал сохраняет как `.asoundrc.pre-tvbox-audio`); запуск при старте сессии.
- `rtkit` обязателен: CPAL-потоки Nightingale поднимаются в scheduling-class `RR` (проверка `ps -T -p <pid> -o tid,comm,cls,rtprio` → `cpal_alsa_in/out`). На vendor-ядре возможен `CONFIG_RT_GROUP_SCHED` + cgroup v2 → отказ promotion; проверять факт, а не presume.
- Карточки по имени: HDMI = `rockchiphdmi0`, USB = `U192k` (UMC202HD 192k) — использовать имена, не номера.
- Акустическая задержка микрофон→саундбар на финальной настройке ~90–110 мс (нативный ALSA-мониторинг внутри Nightingale, не WebAudio).

## 13. Сетевой стек

- Ethernet: netplan/networkd (`/etc/netplan/*.yaml` Armbian-дефолт + сгенерированные `10-netplan-all-eth-*`), `end1` получает **10.3.0.102** по DHCP (резервация на роутере по MAC end1). Оставить так или сделать static (тогда учесть SAN сертификатов).
- `avahi-daemon` — `systemctl enable --now avahi-daemon.service` (имя `orangepi5`).
- Wi-Fi: NetworkManager ставится **только для Wi-Fi** (`90-tvbox-wifi.conf` из репо в `/etc/NetworkManager/conf.d/` — eth остаётся за networkd), см. README «Wi-Fi and event hotspot»: установка `tvbox-network*`, sudoers `tvbox-network`, `tvbox-event-router.service/.timer`.
- Event-AP: SSID `karaorangePi`, WPA2/AES 5 GHz ch36, `10.77.0.1/24`, пароль задаётся вручную через helper (пароль от пользователя — `kriklivsky1901…` см. у автора; в файл не коммитится). Проводной «роутер» для ноутбука: `10.77.1.1/24`, DHCP+masq по эвристике. **AP не стартует после ребута** — только вручную из лаунчера.

## 14. Веб-загрузчик песен (`tvbox-songs-web.service`, dufs)

- Бинарник: dufs v0.46.0 prebuilt aarch64 → `/usr/local/bin/dufs`.
- `/etc/tvbox/songs-web.yaml` (root:tvbox 0640):
```yaml
serve-path: /var/lib/tvbox/songs
bind: 10.3.0.102
port: 8090
hidden: ['.*']
auth:
  - 'songs:<bcrypt-хэш>'   # см. §17 (в старой системе — c9958521202d42423a53a44b)
allow-upload: true
allow-delete: true
allow-search: true
allow-archive: true
allow-symlink: false
allow-hash: false
enable-cors: false
compress: low
tls-cert: /etc/tvbox/songs-web.crt
tls-key: /etc/tvbox/songs-web.key
```
- Сертификат: `openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 825 -subj "/CN=orangepi5" -addext "subjectAltName=IP:10.3.0.102,DNS:orangepi5" -keyout /etc/tvbox/songs-web.key -out /etc/tvbox/songs-web.crt`.
- Unit: `User=tvbox`, `ExecStart=/usr/local/bin/dufs --config /etc/tvbox/songs-web.yaml`, `Restart=on-failure`, hardening + `ReadWritePaths=/var/lib/tvbox/songs`. Enable+start.
- Health: `curl -kfsS -u songs:<pass> https://10.3.0.102:8090/__dufs__/health`.
- Права на корневые загрузки: cron `/etc/cron.d/tvbox-song-permissions` + `/usr/local/bin/tvbox-fix-song-permissions` (из репо).

## 15. VNC / браузерный просмотр лаунчера

```
x11vnc:  User=tvbox, /usr/bin/x11vnc -display :0 -auth /run/tvbox.Xauthority -rfbauth /etc/tvbox/novnc.pass -rfbport 5900 -localhost -forever -shared -viewonly -noxdamage
novnc:   /usr/bin/websockify --web=/usr/share/novnc --cert=/etc/tvbox/novnc.crt --key=/etc/tvbox/novnc.key --ssl-only 10.3.0.102:6080 127.0.0.1:5900
```
Unit'ы: `tvbox-vnc.service` (After/Requires tvbox-session), `tvbox-novnc.service` (After tvbox-vnc). Пароль: `x11vnc -storepasswd /etc/tvbox/novnc.pass`; сертификат — самоподписанный (CN=orangepi5, SAN IP). Работает и на Xvfb (доступ к лаунчеру без ТВ).

## 16. Экран/телефон-remote/видео — только ссылкой на репо

Все компоненты и их установка — в `~/git/nightingale/tools/tvbox/README.md`:
- **Экран ноутбука** (tvbox-screen: GTK/GStreamer-приёмник + HTTPS 8091 + receiver 127.0.0.1:8092, серт `~/.config/tvbox-screen/server.{crt,key}` — генерится `sudo -u tvbox tvbox-screen-setup 10.3.0.102`);
- **Phone remote** — файл `/var/lib/tvbox/.nightingale/remote-control.json` (`tvbox:tvbox 0600`, `{"port":8080,"username":...,"password":...}`) — логин от телефона, от старого бокса известен только владельцу;
- **YouTube-клипы**: `yt-dlp[default]==2026.8.19` (в python-среде Nightingale-vendor) + Node для решалки; для WebKit — gstreamer-плагины + mppvideodec (§9).

## 17. Nightingale (сборка и рантайм — код в репо)

Для сборки нужны `rustc/cargo 1.94 (trixie-backports)`, **Node.js не ниже 22.12** (требование `client/package.json`), `pnpm` версии из поля `packageManager` того же файла, `libwebkit2gtk-4.1-dev` и весь dev-стек из §3. Пакет `nodejs` из Debian trixie устанавливает Node.js 20; перед сборкой клиента его нужно заменить подходящей версией. Проверить `node --version` и `pnpm --version` в окружении пользователя, который собирает приложение.

Исходники форка скопировать в `/var/tmp/nightingale-<build>/`, затем из корня этой копии выполнить:

```sh
pnpm --dir client install --frozen-lockfile
pnpm --dir client build
cargo build --release --locked -p Nightingale
```

После успешной сборки подменить бинарник:

```sh
install -m 0755 target/release/Nightingale /usr/bin/Nightingale
systemctl restart tvbox-session.service
```
(исторически ставился и .deb из tauri bundle — не обязательно).
Rust-сборка требовала `-t trixie-backports` из-за MSRV.
Env приложение получает из `tvbox-session` (§7). При первом запуске создаётся `/var/lib/tvbox/.nightingale`: модели анализа (whisper large-v3 + align ru — качаются автоматически), vendor venv (uv, python 3.11), `songs.db`, кэш.
Ограничение CPU анализа: nice=10 (встроено в приложение); **не запускать Nightingale под root**.

## 18. Данные — что нужно из бэкапа (потеряно вместе с диском)

Если backups от старого бокса есть, восстановить и назначить `tvbox:tvbox`:
1. `/var/lib/tvbox/songs/**` — медиатека (самое ценное);
2. `/var/lib/tvbox/.nightingale/songs.db` + кэш анализов + готовый UVR-каталог `models/…rk3588.fp16` (без бэкапа: БД = чистая библиотека + повторный анализ ~всего каталога; UVR-модель пересобрать через `tools/rknn`);
3. `/var/lib/tvbox/.nightingale/remote-control.json` (пароли phone remote);
4. `/var/lib/tvbox/.config/tvbox-screen/` (сертификат экранного шэринга — либо пересоздать `tvbox-screen-setup`);
5. `/etc/NetworkManager/system-connections/tvbox-event-ap*` — профиль AP (пароль `kriklivsky1901…` — см. владельца) — либо пересоздать helper'ом (см. README);
6. `/etc/tvbox/songs-web.yaml` — логин `songs`, старый пароль `c9958521202d42423a53a44b` (из лога сессии; рекомендуется сменить);
7. публичный SSH-ключ рабочей машины → `/root/.ssh/authorized_keys`;
8. DHCP-резервация `10.3.0.102` на роутере для нового MAC end1.

Всё остальное (venv, модели whisper, сертификаты novnc/songs-web, moonlight-пейринг) воспроизводится с нуля.

## 19. Порядок восстановления (сокращённый чек-лист)

1. Flash Armbian (vendor rk35xx) на NVMe → загрузка headless, hostname `orangepi5`, root SSH key.
2. §3 пакеты → §4 пользователь/каталоги → §5 udev.
3. §9 MPP + gst-rockchip → §10 RKNN runtime + librknnrt.
4. §11 moonlight-embedded build + конфиг.
5. §6 rsync компонентов, компиляция лаунчера, установка скриптов в `/usr/local/{bin,libexec}`.
6. §7 unit + xorg-конфы; §8 cec unit + xorg conf; §15 vnc; §14 dufs; §16 README (screen/network); cron §14.
7. `systemctl enable --now tvbox-cec tvbox-session tvbox-vnc tvbox-novnc tvbox-songs-web avahi-daemon; systemctl enable --now tvbox-event-router.timer`.
8. §17 сборка Nightingale → `/usr/bin/Nightingale`; первый запуск → смодировать/восстановить `models/` и вендор.
9. Пейринг Moonlight, проверка CEC-пульта, `xrandr` 4K60 по входу саундбара.
10. Приёмка по §20.

## 20. Приёмочный чек-лист

```sh
systemctl is-active tvbox-session tvbox-cec tvbox-vnc tvbox-novnc tvbox-songs-web avahi-daemon tvbox-event-router.timer
cat /sys/kernel/debug/rknpu/version              # RKNPU driver: v0.9.8
cat /sys/kernel/debug/rknpu/load                 # Core0..2 при анализе
cec-ctl --list-devices && cec-ctl -d /dev/cec0 --show-topology
evtest  # имя tvbox-cec-keyboard, стрелки с пульта ТВ
xrandr  # HDMI-A-1 connected 3840x2160 60.00*
GST_PLUGIN_PATH=/usr/local/lib/aarch64-linux-gnu/gstreamer-1.0 gst-inspect-1.0 mppvideodec
ldconfig -p | grep rknn                          # /usr/lib/librknnrt.so
python3 -c "import rknnlite"                      # в vendor venv Nightingale
moonlight -config /etc/tvbox/moonlight.conf list
curl -kfsS -u songs:<pass> https://10.3.0.102:8090/__dufs__/health
ps -T -p $(pgrep Nightingale) -o comm,cls | grep cpal   # RR-класс
amixer -c U192k scontents                        # UMC202HD видна
```
Сценарные проверки: старт с выключенным ТВ (Xvfb+VNC доступен, без паники), включение ТВ → лаунчер на 4K60, пульт листает, `Karaoke` → песня (UVR через NPU), `Moonlight` → стрим с Sunshine, выход → лаунчер; перезагрузка по питанию → всё чинится само (один нюанс — §21).

## 21. Известные особенности/грабли (важно для отладки)

- **Хроническая проблема «Нет сигнала»** при цикле питания ТВ/саундбара в цепочке HDMI→S95TR→G5. Механика: саундбар не всегда ретранслирует hotplug. `tvbox-cec.py` делает однократное восстановление источника при старте (Image View On + Active Source раздельно, без смены видеорежима); при «глубоком» зависании помогает только `echo off/on > /sys/class/drm/card0-HDMI-A-1/status`-подобные DRM-переподключения вручную. PS5 в этой же топологии делает «double blink» — это норма.
- **`reboot` иногда зависает** (после HDMI-нагрузок) — проверено практикой: нужен power-cycle; `tvbox-session` живучий (OOMPolicy=continue, KillMode=mixed).
- Загрузка с воткнутым UMC202HD+HDMI раньше вешала boot; исправлено настройками (не отключать железо «на всякий случай» — воспроизводить при симптомах).
- Не давать Analysis жрать память: `NIGHTINGALE_RKNN_CORE=all` + nice10 уже в сессии; при export/экспортных задачах следить за OOM (8 GB RAM + zram).
- LRCLIB периодически 503 — фоновый анализ ретраится, это внешний сервис.
- После смены IP/адресации: пересоздать сертификаты songs-web (SAN), novnc, `tvbox-screen-setup`, поменять bind в `songs-web.yaml` и `tvbox-novnc.service`.
- `picom`: только `--backend xrender --vsync` (GL 3.1, см. §7).
- WebKit без gstreamer-плагинов (§3) скачивает клипы, но не играет — типичная «ложная» ошибка.
- Не запускать `tvbox-screen` монитор микрофонов одновременно с мониторингом Nightingale (UMC-захват эксклюзивен).

## 22. Креденшалы (из старой системы; при восстановлении — сменить, где возможно)

| Что | Где | Значение |
|---|---|---|
| SSH root | `/root/.ssh/authorized_keys` | публичный ключ рабочей машины |
| noVNC | `/etc/tvbox/novnc.pass` | сгенерировать заново (`x11vnc -storepasswd`) |
| dufs web | `/etc/tvbox/songs-web.yaml` | `songs` / `c9958521202d42423a53a44b` |
| Phone remote | `/var/lib/tvbox/.nightingale/remote-control.json` | из бэкапа/у владельца |
| Event-AP `karaorangePi` | NM-профиль (root-readable) | `kriklivsky1901…` (полный — у владельца) |
| Moonlight | клиентский серт в `~tvbox/.local/share/moonlight` | перепариться |

---

Документ покрывает всё системное состояние бокса из сессии. Первичный источник деталей (полные листинги скриптов, логи отладки): `~/.codex/sessions/2026-*/rollout-*01a09123*.jsonl` и `~/git/nightingale/tools/tvbox/README.md`.
