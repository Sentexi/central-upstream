## Quickstart (ohne Docker)

1) ZIP entpacken
2) `.env.example` nach `.env` kopieren und anpassen
3) Start:

Linux:
./run.sh

Windows:
.\run.ps1

Die App laeuft dann auf http://localhost:8000

## Erste Inbetriebnahme

Beim ersten Start passieren zwei Dinge automatisch:

- Falls `SECRET_KEY` nicht in der `.env` steht, wird einer generiert und unter
  `data/.secret_key` abgelegt. Empfehlung: den Wert anschliessend in die `.env`
  uebernehmen und die Datei loeschen, damit das Secret nur an einer Stelle lebt.
- Existiert noch kein Benutzer, wird ein `admin`-Konto mit zufaelligem
  Passwort angelegt. Das Passwort steht in `data/.initial_admin_password`.
  Diese Datei nach dem ersten Login lesen, das Passwort sofort ueber das
  "Credentials aendern"-Formular setzen und dann die Datei loeschen.

## Empfohlene Produktions-Konfiguration

In der `.env`:

```
SECRET_KEY=<openssl rand -base64 64>
SESSION_COOKIE_SECURE=true
PROXY_HOPS=1
```

`SESSION_COOKIE_SECURE=true` setzt voraus, dass der Server ausschliesslich
ueber HTTPS erreichbar ist. Andernfalls werden Cookies vom Browser nicht
gesetzt, der Login funktioniert dann nicht.

## Update auf einen neuen Wheel

1. Neuen Wheel nach `wheels/` legen
2. Service neu starten (`systemctl restart central-upstream` oder `./run.sh`)
3. Bei Wechsel von einer Version vor dem Security-Hardening: bestehende
   Sessions werden ungueltig (Cookie-Signatur aendert sich). Alle Nutzer
   muessen sich einmal neu einloggen.
