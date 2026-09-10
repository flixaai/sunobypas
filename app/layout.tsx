import './globals.css';

export const metadata = {
  title: 'Audio Anonymizer | DSP Bypass',
  description: 'Optimize audio to bypass AI fingerprinting',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}