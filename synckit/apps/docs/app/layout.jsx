import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import "nextra-theme-docs/style.css";

export const metadata = {
  title: { default: "SyncKit Docs", template: "%s — SyncKit" },
  description: "Realtime collaboration infrastructure: presence, comments, notifications.",
};

const navbar = (
  <Navbar
    logo={
      <span style={{ fontWeight: 700 }}>
        <span style={{ color: "#6366f1" }}>◍</span> SyncKit
      </span>
    }
  />
);

const footer = <Footer>© {new Date().getFullYear()} SyncKit</Footer>;

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout navbar={navbar} pageMap={await getPageMap()} footer={footer}>
          {children}
        </Layout>
      </body>
    </html>
  );
}
