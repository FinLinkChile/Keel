import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';

import { TabBar } from '@/ui/TabBar';

// The routes of the tabs are declared in a hidden list; TabBar draws the bar of the design.
export default function TabsLayout() {
  return (
    <Tabs>
      <TabSlot />
      <TabBar />
      <TabList style={{ display: 'none' }}>
        <TabTrigger name="home" href="/home" />
        <TabTrigger name="orders" href="/orders" />
        <TabTrigger name="agent" href="/agent" />
        <TabTrigger name="suppliers" href="/suppliers" />
      </TabList>
    </Tabs>
  );
}
