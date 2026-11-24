import { permanentRedirect } from "next/navigation";

export default function PrivacyRedirectPage() {
  permanentRedirect("/about#privacy");
}
