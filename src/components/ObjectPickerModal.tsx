import { createElement, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { IoBrokerClient } from "../services/iobroker";
import { IoBrokerObjectEntry } from "../types/dashboard";
import { palette } from "../utils/theme";

type ObjectPickerModalProps = {
  client: IoBrokerClient;
  visible: boolean;
  title: string;
  onClose: () => void;
  onSelect: (entry: IoBrokerObjectEntry) => void;
};

type IndexedNode = {
  key: string;
  prefix: string;
  label: string;
  fullId?: string;
};

type TreeIndex = Map<string, IndexedNode[]>;

const SEARCH_DEBOUNCE_MS = 220;
const SEARCH_RESULT_LIMIT = 200;

export function ObjectPickerModal({ client, visible, title, onClose, onSelect }: ObjectPickerModalProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [entries, setEntries] = useState<IoBrokerObjectEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!visible || loaded) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    client
      .listObjects("")
      .then((nextEntries) => {
        if (!active) {
          return;
        }
        setEntries(nextEntries);
        setLoaded(true);
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Objekte konnten nicht geladen werden");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [client, loaded, visible]);

  const treeIndex = useMemo(() => buildTreeIndex(entries), [entries]);
  const rootNodes = treeIndex.get("") || [];
  const searchResults = useMemo(() => filterEntries(entries, debouncedQuery), [debouncedQuery, entries]);

  const renderContent = () => {
    if (debouncedQuery) {
      if (!searchResults.length) {
        return <Text style={styles.emptyText}>{loading ? "Lade Objektliste..." : "Keine Objekte gefunden"}</Text>;
      }

      return searchResults.map((entry) => (
        <Pressable key={entry.id} onPress={() => onSelect(entry)} style={styles.leafRow}>
          <Text style={styles.leafTitle}>{entry.name || entry.id.split(".").pop() || entry.id}</Text>
          <Text numberOfLines={1} style={styles.leafId}>
            {entry.id}
          </Text>
        </Pressable>
      ));
    }

    if (!rootNodes.length) {
      return <Text style={styles.emptyText}>{loading ? "Lade Objektbaum..." : "Keine Objekte gefunden"}</Text>;
    }

    return rootNodes.map((node) => (
      <IndexedTreeBranch
        key={node.prefix}
        expanded={expanded}
        node={node}
        onSelect={onSelect}
        onToggle={(prefix) =>
          setExpanded((current) => ({
            ...current,
            [prefix]: !current[prefix],
          }))
        }
        treeIndex={treeIndex}
      />
    ));
  };

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Schliessen</Text>
            </Pressable>
          </View>
          <TextInput
            autoCapitalize="none"
            onChangeText={setQuery}
            placeholder="Nach Objekt-ID oder Name filtern"
            placeholderTextColor={palette.textMuted}
            style={styles.searchInput}
            value={query}
          />
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {debouncedQuery ? `${searchResults.length} Treffer` : `${entries.length} Objekte geladen`}
            </Text>
            {loading ? <ActivityIndicator color={palette.accent} size="small" /> : null}
          </View>
          <Text style={styles.helperText}>
            Ohne Suche werden nur Ordner geladen und bei Bedarf aufgeklappt. Mit Suche siehst du direkte Treffer.
          </Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {Platform.OS === "web"
            ? createElement(
                "div",
                {
                  style: webTreeScrollStyle,
                },
                renderContent()
              )
            : (
                <ScrollView nestedScrollEnabled style={styles.treeScroll}>
                  {renderContent()}
                </ScrollView>
              )}
        </View>
      </View>
    </Modal>
  );
}

function IndexedTreeBranch({
  node,
  treeIndex,
  expanded,
  onToggle,
  onSelect,
  depth = 0,
}: {
  node: IndexedNode;
  treeIndex: TreeIndex;
  expanded: Record<string, boolean>;
  onToggle: (prefix: string) => void;
  onSelect: (entry: IoBrokerObjectEntry) => void;
  depth?: number;
}) {
  const children = treeIndex.get(node.prefix) || [];
  const hasChildren = children.length > 0;
  const isExpanded = Boolean(expanded[node.prefix]);

  if (!hasChildren && node.fullId) {
    return (
      <Pressable
        onPress={() => onSelect({ id: node.fullId!, name: node.label })}
        style={[styles.leafRow, { paddingLeft: 14 + depth * 16 }]}
      >
        <Text style={styles.leafTitle}>{node.label}</Text>
        <Text numberOfLines={1} style={styles.leafId}>
          {node.fullId}
        </Text>
      </Pressable>
    );
  }

  return (
    <View>
      <Pressable onPress={() => onToggle(node.prefix)} style={[styles.branchRow, { paddingLeft: 14 + depth * 16 }]}>
        <Text style={styles.branchToggle}>{isExpanded ? "▾" : "▸"}</Text>
        <Text style={styles.branchLabel}>{node.label}</Text>
        <Text style={styles.branchMeta}>{children.length}</Text>
      </Pressable>
      {isExpanded
        ? children.map((child) => (
            <IndexedTreeBranch
              key={child.prefix}
              depth={depth + 1}
              expanded={expanded}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
              treeIndex={treeIndex}
            />
          ))
        : null}
    </View>
  );
}

function buildTreeIndex(entries: IoBrokerObjectEntry[]): TreeIndex {
  const index: TreeIndex = new Map();

  const pushChild = (parentPrefix: string, node: IndexedNode) => {
    const bucket = index.get(parentPrefix);
    if (!bucket) {
      index.set(parentPrefix, [node]);
      return;
    }

    const existing = bucket.find((entry) => entry.key === node.key);
    if (!existing) {
      bucket.push(node);
      return;
    }

    if (node.fullId) {
      existing.fullId = node.fullId;
      existing.label = node.label;
    }
  };

  entries.forEach((entry) => {
    const parts = entry.id.split(".");

    parts.forEach((part, indexPosition) => {
      const parentPrefix = parts.slice(0, indexPosition).join(".");
      const prefix = parts.slice(0, indexPosition + 1).join(".");
      pushChild(parentPrefix, {
        key: part,
        prefix,
        label: indexPosition === parts.length - 1 ? entry.name || part : part,
        fullId: indexPosition === parts.length - 1 ? entry.id : undefined,
      });
    });
  });

  index.forEach((nodes, key) => {
    index.set(
      key,
      [...nodes].sort((a, b) => {
        const aLeaf = Boolean(a.fullId);
        const bLeaf = Boolean(b.fullId);
        if (aLeaf !== bLeaf) {
          return aLeaf ? 1 : -1;
        }
        return a.label.localeCompare(b.label, "de");
      })
    );
  });

  return index;
}

function filterEntries(entries: IoBrokerObjectEntry[], query: string) {
  if (!query) {
    return [];
  }

  return entries
    .filter((entry) => {
      return (
        entry.id.toLowerCase().includes(query) ||
        (entry.name && entry.name.toLowerCase().includes(query)) ||
        (entry.role && entry.role.toLowerCase().includes(query))
      );
    })
    .slice(0, SEARCH_RESULT_LIMIT);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    maxHeight: "82%",
    borderRadius: 22,
    padding: 18,
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    color: palette.text,
    fontSize: 20,
    fontWeight: "800",
  },
  close: {
    color: palette.textMuted,
    fontWeight: "700",
  },
  searchInput: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    color: palette.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  metaRow: {
    marginTop: 10,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaText: {
    color: palette.textMuted,
    fontSize: 12,
  },
  helperText: {
    color: palette.textMuted,
    fontSize: 12,
    marginBottom: 10,
    lineHeight: 18,
  },
  errorText: {
    color: palette.danger,
    marginBottom: 10,
  },
  treeScroll: {
    height: 460,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(3, 8, 15, 0.55)",
    paddingVertical: 6,
  },
  branchRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    borderRadius: 12,
    marginHorizontal: 6,
    marginVertical: 1,
    paddingRight: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  branchToggle: {
    width: 16,
    color: palette.textMuted,
  },
  branchLabel: {
    color: palette.text,
    fontWeight: "700",
    flex: 1,
  },
  branchMeta: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  leafRow: {
    marginHorizontal: 6,
    marginVertical: 1,
    paddingVertical: 8,
    paddingRight: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.015)",
  },
  leafTitle: {
    color: palette.text,
    fontWeight: "700",
  },
  leafId: {
    color: palette.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  emptyText: {
    color: palette.textMuted,
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
});

const webTreeScrollStyle = {
  height: "460px",
  overflowY: "auto",
  borderRadius: "16px",
  border: `1px solid ${palette.border}`,
  background: "rgba(3, 8, 15, 0.55)",
  padding: "6px 0",
} as const;
