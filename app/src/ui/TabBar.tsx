import { router } from 'expo-router';
import { TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/session';

import { Icon, type IconName } from './Icon';
import { colors } from './theme';

// Main navigation of 02 and 14: four tabs around a raised New order button. Only the
// importer opens orders, so the exporter gets the four tabs alone.
export function TabBar() {
  const insets = useSafeAreaInsets();
  const { role } = useSession();
  return (
    <View accessibilityRole="tablist" style={{ height: 76 + Math.max(16, insets.bottom), backgroundColor: colors.bg }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: colors.surface,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          paddingBottom: Math.max(16, insets.bottom),
        }}
      >
        <TabTrigger name="home" asChild>
          <TabButton icon="home" label="Home" />
        </TabTrigger>
        <TabTrigger name="orders" asChild>
          <TabButton icon="orders" label="Orders" />
        </TabTrigger>
        {role === 'importer' ? <View style={{ flex: 1 }} /> : null}
        <TabTrigger name="suppliers" asChild>
          <TabButton icon="suppliers" label="Suppliers" />
        </TabTrigger>
        <TabTrigger name="activity" asChild>
          <TabButton icon="activity" label="Activity" />
        </TabTrigger>
      </View>
      {role === 'importer' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New order"
          onPress={() => router.push('/new-order')}
          style={({ pressed }) => ({
            position: 'absolute',
            // 64 of surface plus the 6px ring drawn outside it in the design: a 76px
            // rounded square sitting in the notch of the bar
            left: '50%',
            top: -30,
            marginLeft: -38,
            width: 76,
            height: 76,
            borderRadius: 32,
            backgroundColor: colors.surface,
            borderWidth: 6,
            borderColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Icon name="plus" size={26} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

type ButtonProps = TabTriggerSlotProps & { icon: IconName; label: string };

const TabButton = forwardRef<View, ButtonProps>(function TabButton({ icon, label, isFocused, ...props }, ref) {
  return (
    <Pressable
      ref={ref}
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      style={{ flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' }}
    >
      {/* The design fills only the house when Home is selected */}
      <Icon
        name={icon}
        size={26}
        strokeWidth={1.8}
        color={isFocused ? 'accent' : 'text'}
        filled={isFocused && icon === 'home'}
      />
    </Pressable>
  );
});
