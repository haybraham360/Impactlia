import { redirect } from "next/navigation";
import { START_PATH } from "@/lib/routes";

// The start page's earlier address, kept so old links and bookmarks work.
export default function ChooseOrganizationPage() {
  redirect(START_PATH);
}
