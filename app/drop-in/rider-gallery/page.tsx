"use client";

import dynamic from "next/dynamic";

/** Dev-facing gallery of the Drop In rider rig in every variant. Not linked from the site. */
const RiderGallery = dynamic(() => import("@/components/descent/RiderGallery"), { ssr: false });

export default function RiderGalleryPage() {
  return <RiderGallery />;
}
