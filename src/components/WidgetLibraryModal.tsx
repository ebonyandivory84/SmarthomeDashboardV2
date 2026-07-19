import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WidgetType } from "../types/dashboard";
import { palette } from "../utils/theme";

type WidgetLibraryModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelectType: (type: WidgetType) => void;
  onCreateDashboard: () => void;
  onCreateUrlPage: () => void;
};

const OPTIONS: Array<{
  type: WidgetType;
  title: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}> = [
  {
    type: "state",
    title: "State",
    description: "Schalter, Sensoren und boolesche ioBroker-States lesen und schreiben.",
    icon: "toggle-switch-outline",
  },
  {
    type: "camera",
    title: "Kamera",
    description: "Snapshot-URL pollen und optional RTSP-Link einbinden.",
    icon: "cctv",
  },
  {
    type: "cameraTalk",
    title: "INSTAR Cam",
    description: "Eigenes INSTAR-Kamera-Widget mit Gegensprechen im Vollbild.",
    icon: "microphone",
  },
  {
    type: "cameraTalkReolink",
    title: "Reolink Cam",
    description: "Reolink-Kamera-Widget mit Talkback, Alarm und LED im Vollbild.",
    icon: "cctv",
  },
  {
    type: "energy",
    title: "Energiefluss",
    description: "Kompakter Energiefluss fuer PV, Haus, Batterie und Netz.",
    icon: "transmission-tower-export",
  },
  {
    type: "solar",
    title: "Solar",
    description: "Erweitertes Solar-Widget fuer EKD/PV-Anlagen mit Tageswerten.",
    icon: "solar-power",
  },
  {
    type: "grafana",
    title: "Grafana",
    description: "Beliebige Grafana Panels oder Dashboards per URL als Widget einbetten.",
    icon: "chart-box-outline",
  },
  {
    type: "weather",
    title: "Wetter",
    description: "Aktuelles Wetter und kurze Vorhersage per Koordinaten anzeigen.",
    icon: "weather-partly-cloudy",
  },
  {
    type: "numpad",
    title: "Numpad",
    description: "LCARS-inspiriertes Tastenfeld mit 0-9, Stern und Raute.",
    icon: "dialpad",
  },
  {
    type: "link",
    title: "Link",
    description: "Button, der eine Website im Dashboard-Overlay oeffnet.",
    icon: "link-variant",
  },
  {
    type: "netflix",
    title: "Netflix",
    description: "Oeffnet Netflix im Widget-Fenster (Login weiterhin direkt bei Netflix).",
    icon: "netflix",
  },
  {
    type: "log",
    title: "Log",
    description: "Zeigt Live-Logs aus ioBroker direkt im Dashboard an.",
    icon: "text-box-search-outline",
  },
  {
    type: "script",
    title: "Scripts",
    description: "Zeigt JavaScript-Skripte mit Start/Stopp direkt im Dashboard.",
    icon: "script-text-play-outline",
  },
  {
    type: "host",
    title: "Host",
    description: "Zeigt Host-Stats wie Festplatte, RAM, CPU und Temperatur an.",
    icon: "server-network",
  },
  {
    type: "raspberryPiStats",
    title: "raspberry-pi stats",
    description: "Zeigt CPU, RAM, Disk und Online-Status ueber frei konfigurierbare Datenpunkte.",
    icon: "raspberry-pi",
  },
  {
    type: "coco",
    title: "Coco",
    description: "SureFlap-Status, Lock-Modus und Snapshot der Katzenklappe in einem Widget.",
    icon: "cat",
  },
  {
    type: "wallbox",
    title: "Wallbox",
    description: "Steuert go-e Lademodus, Netzstrom und 80%-Begrenzung in einer kompakten Card.",
    icon: "ev-station",
  },
  {
    type: "goe",
    title: "go-e",
    description: "Spezial-Widget fuer den go-e-gemini-adapter mit vorkonfigurierten States.",
    icon: "ev-station",
  },
  {
    type: "heating",
    title: "Heizung",
    description: "Steuert Viessmann Heizmodus, Solltemperaturen und Warmwasser in einer kompakten Card.",
    icon: "radiator",
  },
  {
    type: "heatingV2",
    title: "Heizung V2",
    description: "Uebersichtlichere Heizungsansicht mit Fokus auf Schnellsteuerung und kompakten Details.",
    icon: "radiator-disabled",
  },
];

export function WidgetLibraryModal({
  visible,
  onClose,
  onSelectType,
  onCreateDashboard,
  onCreateUrlPage,
}: WidgetLibraryModalProps) {
  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Widget-Bibliothek</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Schliessen</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator style={styles.optionScroll}>
            <Pressable
              onPress={() => {
                onCreateDashboard();
                onClose();
              }}
              style={[styles.option, styles.optionFeature]}
            >
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons color={palette.accent} name="view-carousel-outline" size={28} />
              </View>
              <Text style={styles.optionTitle}>Neues Dashboard</Text>
              <Text style={styles.optionText}>Erstellt eine weitere Seite, zwischen der du wischen oder tippen kannst.</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onCreateUrlPage();
                onClose();
              }}
              style={[styles.option, styles.optionFeature]}
            >
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons color={palette.accent} name="web" size={28} />
              </View>
              <Text style={styles.optionTitle}>Neue URL-Seite</Text>
              <Text style={styles.optionText}>Erstellt eine Side Page, die eine komplette Webseite als Inhalt rendert.</Text>
            </Pressable>
            {OPTIONS.map((option, index) => (
              <Pressable
                key={`${option.type}-${index}`}
                onPress={() => {
                  onSelectType(option.type);
                  onClose();
                }}
                style={styles.option}
              >
                <View style={styles.iconWrap}>
                  <MaterialCommunityIcons color={palette.accent} name={option.icon} size={28} />
                </View>
                <Text style={styles.optionTitle}>{option.title}</Text>
                <Text style={styles.optionText}>{option.description}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    padding: 22,
  },
  card: {
    borderRadius: 24,
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    maxHeight: "90%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: {
    color: palette.text,
    fontSize: 22,
    fontWeight: "800",
  },
  close: {
    color: palette.textMuted,
    fontWeight: "600",
  },
  optionScroll: {
    flexGrow: 0,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingBottom: 2,
  },
  option: {
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 170,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  optionFeature: {
    backgroundColor: "rgba(77, 226, 177, 0.05)",
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(77, 226, 177, 0.08)",
  },
  optionTitle: {
    marginTop: 14,
    color: palette.text,
    fontSize: 18,
    fontWeight: "800",
  },
  optionText: {
    marginTop: 8,
    color: palette.textMuted,
    lineHeight: 20,
  },
});
