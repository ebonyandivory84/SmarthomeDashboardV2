# Widget-Autoskalierung und Deployment

Stand: 10. August 2026

## Ziel

Die Inhalte dichter Widgets sollten sich einschließlich Schriftgrößen, Icons, Abständen und Grafiken automatisch an die aktuelle Widgetgröße anpassen. Dabei sollten keine Überlagerungen oder abgeschnittenen Inhalte entstehen und keine dauerhafte zusätzliche Systemlast verursacht werden.

Auslöser war insbesondere das analoge Zeigerinstrument im Wallbox-V2-Widget, das am unteren Rand abgeschnitten wurde.

## Sicherung vor der Änderung

Vor Beginn wurde der damalige Git-Stand mit einem annotierten Tag gesichert:

- Tag: `vorAutoSkalierung`
- Gesicherter Commit: `7478f96cf99a175adfac97ceab817ff9044a6eb6`
- Der Tag wurde ebenfalls zu GitHub gepusht.

## Umsetzung

### Gemeinsame Auto-Fit-Komponente

Neu angelegt wurde:

- `src/components/AutoFitContent.tsx`

Die Komponente:

- misst den verfügbaren Widgetbereich und die natürliche Größe des Inhalts,
- berechnet einen einheitlichen Skalierungsfaktor für Breite und Höhe,
- skaliert Schrift, Icons, Abstände, Bedienelemente und Grafiken gemeinsam,
- kann Inhalte auch über den bisherigen Faktor `1` hinaus vergrößern,
- verwendet keine Mindestskalierung, die erneut Überstand erzwingen könnte,
- verhindert Subpixel-Clipping durch konservative Rundung,
- deaktiviert Eingaben, solange die erste Größenmessung noch nicht abgeschlossen ist,
- verwendet ausschließlich Layout-Ereignisse und weder Polling noch zusätzliche dauerhafte Observer.

### Wallbox und go-e

Geändert wurden:

- `src/components/widgets/WallboxWidget.tsx`
- `src/components/widgets/WallboxAnalogWidget.tsx`

Umgesetzt wurden:

- automatische Umschaltung zwischen gestapeltem und zweispaltigem Layout,
- Hysterese am Layout-Breakpoint, damit das Layout beim Größenändern nicht flackert,
- intrinsische Inhaltshöhe statt der früheren festen Annahme von `560 × 292 px`,
- Entfernung der bisherigen Skalierungsbegrenzung von `0,72–1,0`,
- feste Bereiche für Untertitel und Statusmeldungen gegen Layoutsprünge,
- tabellarische Ziffern für stabilere Leistungs-, Energie- und Prozentanzeigen,
- Memoisierung des aufwendigen analogen Zeigerinstruments.

Das analoge SVG verwendet jetzt:

- `width: 100%`,
- `height: 100%`,
- einen festen `viewBox`,
- `preserveAspectRatio: xMidYMid meet`.

Damit bleibt das vollständige Instrument einschließlich der unteren Kante innerhalb seines verfügbaren Bereichs sichtbar.

### Heating V2

Geändert wurde:

- `src/components/widgets/HeatingWidgetV2.tsx`

Das Widget verwendet nun ebenfalls die gemeinsame Auto-Fit-Komponente. Untertitel, Detailticker und Footer besitzen reservierte Höhen, damit Statusänderungen nicht zu Verschiebungen oder einer laufenden Neuberechnung der Gesamtskalierung führen.

### Erste Ausbaustufe: bewusst nicht global skaliert

In der ersten Ausbaustufe wurde die Skalierung nicht pauschal im `WidgetFrame` aktiviert. Medien-, Kamera-, Grafana-, Scroll-, Solar- und State-Widgets besaßen bereits eigene responsive beziehungsweise interaktive Layoutlogik. Eine ungeprüfte globale zusätzliche Skalierung hätte dort Medienformate, Scrollbereiche oder Touch-Ziele beeinträchtigen können.

## Erweiterung auf weitere Widgets

Nachdem sich die Autoskalierung im go-e-Wallbox-Widget im praktischen Betrieb bewährt hatte, wurde der Stand vor der Erweiterung erneut lokal gesichert:

- Tag: `autoScaleGo-e`
- Gesicherter Commit: `e08e313a03af33b8c4229b57a9e249d935b1ab67`
- Der Tag ist aktuell nur lokal vorhanden und wurde noch nicht zu GitHub gepusht.

### Virtuelle Mindest-Designfläche

Neu angelegt wurde:

- `src/components/AutoScaleSurface.tsx`

Die Komponente lässt Widgets oberhalb einer sicheren Mindestgröße weiterhin vollständig flexibel und unverändert ausfüllend rendern. Wird ein Widget kleiner, wird intern eine größere virtuelle Fläche mit demselben Seitenverhältnis bereitgestellt und anschließend mit genau einem gemeinsamen Transform auf die reale Widgetgröße verkleinert.

Damit skalieren Schrift, Karten, Icons, Abstände und Bedienelemente gemeinsam. Es gibt keine Polling-Schleife, keinen zusätzlichen Animationszyklus und keine Remounts beim Größenändern. Eine Neuberechnung erfolgt ausschließlich nach einer tatsächlichen Layoutänderung. Bei normal großen Widgets wird kein Transform gesetzt; außerdem ist die virtuelle Achsengröße für extreme Seitenverhältnisse auf `4096 px` begrenzt.

Autoskalierung ist nun zusätzlich für folgende Widget-Typen vorgesehen:

- State
- Energy
- Solar
- Weather
- Numpad
- Host-Statistiken
- Raspberry-Pi-Statistiken
- Coco
- ältere Heating-Ansicht

Der generische Widget-Titel und das bisherige Content-Padding liegen bei diesen Typen innerhalb derselben Skalierfläche. Editier-, Verschiebe- und Resize-Bedienelemente bleiben außerhalb und behalten ihre normale Bediengröße.

### Solar-Widget

Die Überlagerungen im verkleinerten Solar-Widget entstanden durch unterschiedliche Skalierungsgrenzen: Positionen und Verbindungsgeometrie wurden weiter verkleinert, während Karten, Statistikbereiche, Icons und Schriften feste Mindestgrößen erreichten. Dadurch wurden die Inhalte relativ zu ihren verfügbaren Flächen immer größer und kollidierten schließlich.

Das Solar-Widget erhält nun eine virtuelle Mindestfläche von `960 × 960 px`. Unterhalb dieser Größe wird die gesamte Darstellung proportional verkleinert. Dadurch bleiben alle Größenverhältnisse erhalten und die Karten können nicht mehr allein aufgrund unterschiedlicher Mindestgrößen ineinanderrutschen.

### Bewusst weiterhin fluid

Folgende Widgets werden nicht als gesamte Fläche transformiert:

- Camera und CameraTalk: Video- und Bildflächen füllen den Rahmen bereits fluid.
- Grafana: iframe und Vorschaubild sollen weiterhin direkt die verfügbare Fläche nutzen.
- Link und Netflix: maximierte Bilder verwenden bereits prozentuale Größen.
- Log und Script: lange Inhalte müssen scrollbar bleiben; ein Gesamttransform würde Scrollhöhe, Touch-Verhalten und Lesbarkeit verschlechtern.

Diese Ausnahmen verhindern eine unnötige zusätzliche Transform-Ebene bei Medien und großen Scrollflächen.

### Prüfungen der Erweiterung

Erfolgreich durchgeführt wurden:

- strikter TypeScript-Typecheck mit Node.js `20.19.0`,
- `git diff --check`,
- vollständiger Expo-Web-Export nach `adapter/www`,
- Vergleich der Hauptbundle-Größe.

Das Hauptbundle wuchs durch die gemeinsame Skalierfläche lediglich um `2.314 Bytes` unkomprimiert beziehungsweise `702 Bytes` gzip-komprimiert. Das neue erzeugte Hauptbundle heißt:

`main-7c555481a7f7b923e055665bb725a185.js`

Eine visuelle Browserprüfung war in der Arbeitsumgebung nicht möglich, da weder eine Browsersitzung verfügbar war noch der lokale Testserver gestartet werden konnte. Die Erweiterung wurde anschließend zusammen mit dem Produktions-Build committed, zu GitHub gepusht und nach dem im `README.md` beschriebenen Verfahren auf das Produktivsystem ausgerollt.

## Prüfungen

Folgende Prüfungen wurden erfolgreich durchgeführt:

- TypeScript: `tsc --noEmit`
- Whitespace- und Patchprüfung: `git diff --check`
- vollständiger Expo-Web-Export nach `adapter/www`
- Syntaxprüfung der erzeugten JavaScript-Bundles
- unabhängige statische Reviews der Skalierungs- und Wallbox-Änderungen

Ein visueller Screenshot-Test über die integrierte Browsersteuerung war nicht möglich, weil in der Arbeitsumgebung keine Browsersitzung verfügbar war.

## Git-Commit und GitHub der ersten Ausbaustufe

Die Änderung einschließlich des erzeugten Produktions-Builds wurde committed und gepusht:

- Commit: `e08e313a03af33b8c4229b57a9e249d935b1ab67`
- Kurzform: `e08e313`
- Commit-Nachricht: `feat: Widget-Inhalte automatisch skalieren`
- Branch: `main`
- Remote: `origin`

Nach dem Push waren lokaler Branch und `origin/main` synchron.

## Deployment der ersten Ausbaustufe

Die konkreten Ziel- und Zugangsdaten sowie das verbindliche Deployment-Verfahren sind zentral im `README.md` dokumentiert und werden hier nicht dupliziert.

Der Pi hat den Commit direkt vom GitHub-Branch `main` geklont. Vor dem Kopieren wurde geprüft, dass der geklonte Commit exakt `e08e313a03af33b8c4229b57a9e249d935b1ab67` entspricht.

Auf dem Pi wurden anschließend ausgeführt:

1. `npm ci`
2. `npm run export:web`
3. Sicherung des bisherigen Frontends
4. Kopieren des neuen Exports nach `adapter/www`
5. Neustart von `smarthome-dashboard-v2.0`
6. Instanz- und HTTP-Prüfung

Erstelltes Pi-Backup:

`/opt/iobroker/backups/smarthome-dashboard-v2-www-before-e08e313`

Ergebnis der Produktionsprüfung:

- Instanzstatus: `running`
- HTTP-Status: `200`
- ausgeliefertes Hauptbundle: `main-0e111fbc09f76a725bd809eb66b7eace.js`

## Rücksetzoptionen

### Dauerhafter Git-Rollback

Die Änderung kann nicht-destruktiv mit einem Revert zurückgenommen werden:

```bash
git revert e08e313
git push origin main
```

Danach sollte der neue Revert-Commit erneut nach dem dokumentierten Pi-Verfahren deployed werden.

### Wechsel auf den gesicherten Ausgangsstand

Der Zustand vor der Autoskalierung ist über den Tag verfügbar:

```bash
git switch --detach vorAutoSkalierung
```

Für eine dauerhafte Rückkehr auf `main` ist ein Revert vorzuziehen.

### Schneller Frontend-Rollback auf dem Pi

Das vor dem Deployment gesicherte Frontend befindet sich unter:

`/opt/iobroker/backups/smarthome-dashboard-v2-www-before-e08e313`

Nach dem Zurückkopieren in das Frontend-Ziel muss die Instanz neu gestartet und erneut mit HTTP `200` geprüft werden.

## Deployment der Erweiterung

Die Erweiterung auf die zusätzlichen Widget-Typen wurde am 13. August 2026 zusammen mit dem erzeugten Webexport committed und zu GitHub gepusht. Der Backup-Tag `autoScaleGo-e` wurde ebenfalls veröffentlicht.

Für das Produktiv-Deployment wurde exakt der veröffentlichte Stand in ein temporäres Verzeichnis geklont und dort neu gebaut. Vor dem Austausch des Frontends wurde das zuvor ausgelieferte `adapter/www` gesichert. Anschließend wurden die Instanz neu gestartet sowie Instanzstatus, HTTP-Status und ausgeliefertes Hauptbundle kontrolliert.

Für einen Git-Rollback der Erweiterung dient der Tag `autoScaleGo-e` als eindeutig gesicherter Ausgangspunkt. Das unmittelbar vor dem Austausch angelegte Server-Backup ermöglicht zusätzlich eine schnelle Wiederherstellung des vorherigen Frontends.
