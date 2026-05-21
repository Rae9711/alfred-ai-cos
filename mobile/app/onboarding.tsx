import { useRouter } from "expo-router";

import { OnboardingScreen } from "@/screens/OnboardingScreen";

export default function OnboardingRoute() {
  const router = useRouter();
  return <OnboardingScreen onDone={() => router.replace("/(tabs)")} />;
}
