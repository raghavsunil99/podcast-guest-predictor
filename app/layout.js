import "./globals.css";

export const metadata = {
  title: "Podcast Guest Predictor",
  description: "Predict which guests will accept and generate personalized Entri Podcast invitations from LinkedIn profiles. Built by Raghav.",
  authors: [{ name: "Raghav" }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
