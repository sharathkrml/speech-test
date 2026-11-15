import "./globals.css";

export const metadata = {
  title: "Tongue Twister",
  description: "Read five tongue twisters out loud to pass. Speech recognition runs in your browser.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
