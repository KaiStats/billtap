import HeroSection from '@/components/HeroSection';
import HowItWorks from '@/components/HowItWorks';
import Features from '@/components/Features';
import FinalCTA from '@/components/FinalCTA';
import DownloadApp from '@/components/DownloadApp';
import Footer from '@/components/Footer';

const LandingPage = () => {
  return (
    <div className="relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-[#667eea] focus:font-bold focus:rounded-lg focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>
      <main id="main-content">
        <HeroSection />
        <HowItWorks />
        <Features />
        <DownloadApp />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
};

export default LandingPage;