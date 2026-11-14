import { useState } from "react";
import { motion } from "framer-motion";
import {
  Image as ImageIcon, Star, Download, Globe, Telescope, Satellite,
  AlertCircle, Sparkles, Map as MapIcon, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

const downloadImage = (imageUrl, filename) => {
  const link = document.createElement("a");
  link.href = imageUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const sourceIcon = (source = "") => {
  if (source.includes("2MASS")) return <Globe className="w-4 h-4 text-orange-300" />;
  if (source.includes("WISE")) return <Satellite className="w-4 h-4 text-rose-300" />;
  if (source.includes("DSS")) return <Telescope className="w-4 h-4" style={{ color: "var(--ink-3)" }} />;
  return <ImageIcon className="w-4 h-4 text-slate-300" />;
};

const ImageCard = ({ title, url, description, filename, delay = 0, badge, fits }) => {
  const t = useT();
  return (
  <motion.div
    initial={{ opacity: 0, scale: 0.97 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay }}
    className="panel rounded-xl overflow-hidden hover-lift"
  >
    <div className="p-3.5 flex items-center justify-between border-b border-white/5 bg-black/20">
      <div className="flex items-center gap-2 min-w-0">
        {sourceIcon(title)}
        <span className="text-sm font-medium text-slate-200 truncate">{title}</span>
        {badge && (
          <span className="tag shrink-0" style={{ fontSize: 10 }}>
            {badge}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {fits && (
          <a
            href={fits}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10.5px] px-2 py-1 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 mono"
            title={t("Скачать научный FITS-файл этого поля (с WCS-координатами, открывается в DS9 / Astropy)", "Download the scientific FITS file of this field (with WCS coordinates, opens in DS9 / Astropy)")}
          >
            FITS
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-cyan-400 hover:text-cyan-200 h-8 w-8 p-0"
          onClick={() => downloadImage(url, filename)}
          title={t("Скачать JPG", "Download JPG")}
        >
          <Download className="w-4 h-4" />
        </Button>
      </div>
    </div>
    <div className="bg-black/40">
      <img src={url} alt={title} className="w-full h-auto" style={{ maxHeight: 420, objectFit: "contain" }} loading="lazy" />
    </div>
    {description && (
      <div className="p-3 text-xs text-slate-400 border-t border-white/5">{description}</div>
    )}
  </motion.div>
  );
};

const SkeletonCard = ({ h = 300 }) => (
  <div className="panel rounded-xl overflow-hidden">
    <div className="p-3.5 border-b border-white/5"><div className="skeleton h-4 w-40 rounded" /></div>
    <div className="skeleton rounded-none" style={{ height: h }} />
  </div>
);

const ImagesTab = ({ data, imagesLoading = false }) => {
  const t = useT();
  const viz = data.visualizations || {};
  const realImages = viz.real_images || [];
  const aladin = viz.aladin;
  const hostStar = data.host_star?.name;
  const safeName = (data.name || "planet").replace(/\s+/g, "_");
  const [aladinLoaded, setAladinLoaded] = useState(false);

  // научный FITS того же поля (hips2fits отдаёт с WCS-заголовками)
  const fitsUrl = (survey) =>
    aladin?.ra != null && survey
      ? "https://alasky.cds.unistra.fr/hips-image-services/hips2fits?" +
        `hips=${encodeURIComponent(survey)}&width=1000&height=1000&fov=0.25&projection=TAN` +
        `&coordsys=icrs&ra=${aladin.ra}&dec=${aladin.dec}&format=fits`
      : null;

  if (imagesLoading && !data.visualizations) {
    return (
      <div className="space-y-6">
        <div className="panel rounded-xl p-4 flex items-center gap-3 text-sm text-slate-300">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 pulse-soft shrink-0" />
          {t("Скачиваем реальные снимки неба (DSS2 / 2MASS / WISE) и рисуем портреты — обычно 3–6 секунд…", "Downloading real sky images (DSS2 / 2MASS / WISE) and drawing portraits — usually 3–6 seconds…")}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <SkeletonCard h={340} />
          <SkeletonCard h={340} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          <SkeletonCard h={240} />
          <SkeletonCard h={240} />
          <SkeletonCard h={240} />
        </div>
      </div>
    );
  }

  const downloadAll = () => {
    const all = [
      ...realImages.map((im, i) => [im.url, `${safeName}_${(im.source || i).toString().replace(/[^a-zA-Z0-9]/g, "_")}.jpg`]),
      viz.planet_portrait && [viz.planet_portrait, `${safeName}_portrait.jpg`],
      viz.synthetic_star && [viz.synthetic_star, `${safeName}_star.jpg`],
    ].filter(Boolean);
    all.forEach(([url, name], i) => setTimeout(() => downloadImage(url, name), i * 350));
    toast.success(t(`Скачивание ${all.length} изображений…`, `Downloading ${all.length} images…`));
  };

  return (
    <div className="space-y-6">
      {/* Художественные портреты */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
            {t("Художественная реконструкция", "Artistic reconstruction")}
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={downloadAll}
            className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 rounded-lg"
          >
            <Download className="w-4 h-4 mr-1.5" /> {t("Скачать все изображения", "Download all images")}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {viz.planet_portrait && (
            <ImageCard
              title={t(`Планета ${data.name}`, `Planet ${data.name}`)}
              badge={t("генерация по данным", "data-driven render")}
              url={viz.planet_portrait}
              filename={`${safeName}_portrait.jpg`}
              description={t("Внешний вид смоделирован по радиусу, массе и температуре планеты: тип поверхности, атмосфера и облачность — художественная интерпретация.", "Appearance modeled from the planet's radius, mass and temperature: surface type, atmosphere and clouds — an artistic interpretation.")}
            />
          )}
          {viz.synthetic_star && (
            <ImageCard
              title={t(`Звезда ${hostStar || ""}`, `Star ${hostStar || ""}`)}
              badge={t("генерация по данным", "data-driven render")}
              url={viz.synthetic_star}
              filename={`${safeName}_star.jpg`}
              delay={0.08}
              description={t("Цвет и размер звезды соответствуют её температуре и радиусу; грануляция и лимбовое потемнение — как у реальных звёзд.", "The star's color and size match its temperature and radius; granulation and limb darkening are like those of real stars.")}
            />
          )}
        </div>
      </div>

      {/* Реальные снимки */}
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-1">
          <Telescope className="w-5 h-5" style={{ color: "var(--ink-3)" }} />
          {t("Реальные снимки поля звезды", "Real images of the star field")} ({realImages.length})
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          {t(`Настоящие фотографии участка неба вокруг ${hostStar || "звезды"} из профессиональных обзоров. Перекрестие — положение звезды.`, `Real photographs of the sky region around ${hostStar || "the star"} from professional surveys. The crosshair marks the star's position.`)}
        </p>
        {realImages.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {realImages.map((img, index) => (
              <ImageCard
                key={img.source || index}
                title={img.source}
                url={img.url}
                filename={`${safeName}_${(img.source || index).toString().replace(/[^a-zA-Z0-9]/g, "_")}.jpg`}
                description={img.description}
                delay={index * 0.08}
                fits={fitsUrl(img.survey)}
              />
            ))}
          </div>
        ) : imagesLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            <SkeletonCard h={240} />
            <SkeletonCard h={240} />
            <SkeletonCard h={240} />
          </div>
        ) : (
          <div className="panel rounded-xl p-6 border border-orange-500/25 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
            <p className="text-sm text-orange-200/90">
              {t("Снимки не загрузились: у звезды ", "Images did not load: the star ")}{hostStar ? <b>{hostStar}</b> : null}{t(" нет точных координат или сервис hips2fits временно недоступен.", " has no precise coordinates, or the hips2fits service is temporarily unavailable.")}
            </p>
          </div>
        )}
      </div>

      {/* Интерактивная карта неба */}
      {aladin?.ra != null && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="card-glow rounded-xl overflow-hidden"
        >
          <div className="p-4 flex items-center justify-between border-b border-white/5">
            <div className="flex items-center gap-2">
              <MapIcon className="w-4 h-4" style={{ color: "var(--ink-3)" }} />
              <h2 className="text-lg font-semibold text-white">{t("Интерактивная карта неба (Aladin)", "Interactive sky map (Aladin)")}</h2>
            </div>
            <a
              href={data.external_links?.aladin}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              {t("Открыть в новом окне", "Open in a new window")} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="relative bg-black/60" style={{ height: 480 }}>
            {!aladinLoaded && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                {t("Загрузка карты неба…", "Loading sky map…")}
              </div>
            )}
            <iframe
              title="Aladin Lite"
              src={`https://aladin.cds.unistra.fr/AladinLite/?target=${aladin.ra}%20${aladin.dec}&fov=0.35&survey=P%2FDSS2%2Fcolor`}
              className="w-full h-full border-0 relative"
              loading="lazy"
              onLoad={() => setAladinLoaded(true)}
            />
          </div>
          <p className="p-3 text-xs text-slate-500">
            {t(`Живой атлас неба CDS: можно приближать, перемещаться и переключать обзоры — звезда ${hostStar} в центре.`, `Live CDS sky atlas: you can zoom, pan and switch surveys — the star ${hostStar} is at the center.`)}
          </p>
        </motion.div>
      )}

      {/* Пояснение */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="panel rounded-xl p-6"
      >
        <h3 className="text-base font-semibold text-white mb-2">{t("Почему нет фотографии самой планеты?", "Why is there no photo of the planet itself?")}</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          {t("Прямое изображение экзопланеты — редчайшее достижение: на расстоянии световых лет планета в миллиарды раз тусклее своей звезды. Из ~6000 подтверждённых планет напрямую сфотографированы лишь десятки. Поэтому мы показываем ", "Directly imaging an exoplanet is an extremely rare feat: at a distance of light-years, a planet is billions of times fainter than its star. Of the ~6000 confirmed planets, only a few dozen have been imaged directly. That is why we show ")}<b className="text-slate-300">{t("реальные снимки звезды", "real images of the star")}</b>{t(" из обзоров неба (оптика DSS2, инфракрасные 2MASS и WISE) и ", " from sky surveys (optical DSS2, infrared 2MASS and WISE) and a ")}<b className="text-slate-300">{t("научно обоснованную реконструкцию", "scientifically grounded reconstruction")}</b>{t(" внешнего вида планеты по измеренным параметрам.", " of the planet's appearance based on measured parameters.")}
        </p>
      </motion.div>
    </div>
  );
};

export default ImagesTab;
