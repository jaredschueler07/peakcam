import { permanentRedirect } from "next/navigation";

export default function TermsRedirectPage() {
  permanentRedirect("/about#terms");
}
