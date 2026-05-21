import { useLocalSearchParams } from "expo-router";

import { MeetingPrepScreen } from "@/screens/MeetingPrepScreen";

export default function MeetingPrepRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MeetingPrepScreen eventId={id} />;
}
