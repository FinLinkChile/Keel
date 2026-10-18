import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { agentNoteAction, agentNoteText } from '@/data/agentNoteText';
import type { AgentNote, NoteRule, NoteTone } from '@/data/agentNotes';

import { Text } from './Text';
import { colors, radius } from './theme';

const DOT: Record<NoteTone, string> = { warning: colors.danger, caution: colors.yourTurn, info: colors.accent };

// The agent's notes before signing. With `onApply` a note with a suggestion can change the term;
// without it (the order is already signed by the other side) the notes only inform.
export function AgentNotes({ notes, onApply, footer }: { notes: AgentNote[]; onApply?: (note: AgentNote) => void; footer: string }) {
  const [ignored, setIgnored] = useState<NoteRule[]>([]);
  const shown = notes.filter((n) => !ignored.includes(n.rule));
  if (shown.length === 0) return null;

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 14 }}>
      <Text size={13} weight={700} color="textMuted" style={{ letterSpacing: 0.4 }}>
        AGENT NOTES
      </Text>
      {shown.map((note) => {
        const action = onApply ? agentNoteAction(note) : undefined;
        return (
          <View key={note.rule} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: DOT[note.tone] }} />
              <Text size={14} leading={1.45} color="textSoft" style={{ flex: 1 }}>
                {agentNoteText(note)}
              </Text>
            </View>
            {action ? (
              <View style={{ flexDirection: 'row', gap: 16, paddingLeft: 18 }}>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onApply!(note)}>
                  <Text size={14} weight={700} style={{ color: colors.accent }}>
                    {action}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setIgnored([...ignored, note.rule])}>
                  <Text size={14} color="textMuted">
                    Ignore
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
      <Text size={12} leading={1.4} color="textFaint">
        {footer}
      </Text>
    </View>
  );
}
