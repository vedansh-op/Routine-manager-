import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppStoreProvider } from "@/store/AppStore";

export default function RootLayout() {
  return (
    <AppStoreProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#101216" } }} />
    </AppStoreProvider>
  );
}
