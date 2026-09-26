import { type ChangeEvent, type DragEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowUpDown, Check, ChevronDown, CircleAlert, CloudUpload, ExternalLink, FileDown, FileText, Info, Link2, LoaderCircle, Search, ShieldCheck, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

type StoreName = 'Melcom' | 'Shoprite' | 'China Mall' | string;

type Offer = {
  productName: string;
  normalizedProduct: string;
  store: StoreName;
  price: number;
  url: string | null;
};

type Product = {
  key: string;
  name: string;
  offers: Offer[];
};

type ParseResult = {
  offers: Offer[];
  skippedBlank: number;
  skippedMalformed: number;
  invalidUrls: number;
  sourceName: string;
};

type LoadStatus = 'idle' | 'reading' | 'ready' | 'error';

const queryClient = new QueryClient();

const SAMPLE_CSV = `product,store,price,url
Tropical Sun Rice 5kg,Melcom,82.5,https://melcom.com
Tropical Sun Rice 5kg,Shoprite,86.99,https://shoprite.com.gh
Tropical Sun Rice 5kg,China Mall,79.95,https://www.google.com/maps/search/China+Mall+Ghana
Kivo Gari 1kg,Melcom,18.75,https://melcom.com
Kivo Gari 1kg,Shoprite,20.4,https://shoprite.com.gh
Kivo Gari 1kg,China Mall,17.5,https://www.google.com/maps/search/China+Mall+Ghana
Pepsi 1.5L,Melcom,16.9,https://melcom.com
Pepsi 1.5L,Shoprite,15.75,https://shoprite.com.gh
Pepsi 1.5L,China Mall,14.99,https://www.google.com/maps/search/China+Mall+Ghana
Key Soap 175g,Melcom,9.5,https://melcom.com
Key Soap 175g,Shoprite,10.25,https://shoprite.com.gh
Key Soap 175g,China Mall,8.9,https://www.google.com/maps/search/China+Mall+Ghana
Milo 500g,Melcom,39.99,https://melcom.com
Milo 500g,Shoprite,42.5,https://shoprite.com.gh
Milo 500g,China Mall,37.75,https://www.google.com/maps/search/China+Mall+Ghana`;

const currency = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 2,
});

const STORE_META: Record<string, { short: string; className: string; description: string }> = {
  melcom: { short: 'M', className: 'bg-[#ed6b3f] text-white', description: 'Everyday retail' },
  shoprite: { short: 'S', className: 'bg-[#1665a9] text-white', description: 'Supermarket' },
  'china mall': { short: 'C', className: 'bg-[#e7bd35] text-[#29354a]', description: 'Value market' },
};

function normalizeProduct(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-GH')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeHeader(value: string) {
  return value.toLocaleLowerCase('en-GH').replace(/[^a-z0-9]/g, '');
}

function safeHttpsUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((part) => part.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((part) => part.trim())) rows.push(row);
  return rows;
}

function parsePrice(value: string | undefined) {
  if (!value?.trim()) return null;
  const cleaned = value.trim().replace(/[₵$€£,\s]/g, '');
  const price = Number(cleaned);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function canonicalStore(value: string) {
  const cleaned = value.trim();
  const key = normalizeProduct(cleaned);
  if (key.includes('melcom')) return 'Melcom';
  if (key.includes('shoprite')) return 'Shoprite';
  if (key.includes('china mall') || key === 'chinamall') return 'China Mall';
  return cleaned || 'Other store';
}

function parsePriceCsv(text: string, sourceName: string): ParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Add a header row and at least one product row to continue.');

  const headers = rows[0].map(normalizeHeader);
  const findColumn = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const productColumn = findColumn(['product', 'productname', 'name', 'item', 'itemname', 'description']);
  const storeColumn = findColumn(['store', 'storename', 'retailer', 'shop', 'merchant']);
  const priceColumn = findColumn(['price', 'cost', 'amount', 'sellingprice', 'unitprice']);
  const urlColumn = findColumn(['url', 'link', 'storeurl', 'website', 'producturl', 'shopurl']);

  if (productColumn === -1 || storeColumn === -1 || priceColumn === -1) {
    throw new Error('We need product, store, and price columns. Header aliases such as name, retailer, and amount also work.');
  }

  const offers: Offer[] = [];
  let skippedBlank = 0;
  let skippedMalformed = 0;
  let invalidUrls = 0;

  rows.slice(1).forEach((columns) => {
    const productName = columns[productColumn]?.trim() ?? '';
    const store = columns[storeColumn]?.trim() ?? '';
    if (!productName && !store && !columns[priceColumn]?.trim()) {
      skippedBlank += 1;
      return;
    }
    const price = parsePrice(columns[priceColumn]);
    if (!productName || !store || price === null) {
      skippedMalformed += 1;
      return;
    }
    const rawUrl = urlColumn === -1 ? undefined : columns[urlColumn];
    const url = safeHttpsUrl(rawUrl);
    if (rawUrl?.trim() && !url) invalidUrls += 1;
    offers.push({
      productName,
      normalizedProduct: normalizeProduct(productName),
      store: canonicalStore(store),
      price,
      url,
    });
  });

  if (!offers.length) throw new Error('No usable product rows were found. Check that prices are numbers greater than zero.');
  return { offers, skippedBlank, skippedMalformed, invalidUrls, sourceName };
}

function readFileWithProgress(file: File, onProgress: (value: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(92, Math.round((event.loaded / event.total) * 92)));
    };
    reader.onerror = () => reject(new Error('The file could not be read in this browser.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

function formatPrice(value: number) {
  return currency.format(value).replace('GHS', 'GH₵');
}

function StoreMark({ store, large = false }: { store: string; large?: boolean }) {
  const meta = STORE_META[normalizeProduct(store)] ?? {
    short: store.slice(0, 1).toUpperCase(),
    className: 'bg-[#33415c] text-white',
    description: 'Retailer',
  };
  return (
    <div className={`flex items-center gap-2.5 ${large ? 'gap-3' : ''}`} data-testid={`logo-store-${normalizeProduct(store)}`}>
      <div className={`grid shrink-0 place-items-center rounded-xl font-bold shadow-sm ${meta.className} ${large ? 'size-11 text-base' : 'size-9 text-sm'}`}>
        {meta.short}
      </div>
      <div className="min-w-0">
        <p className={`truncate font-semibold text-foreground ${large ? 'text-base' : 'text-sm'}`}>{store}</p>
        <p className="text-[11px] text-muted-foreground">{meta.description}</p>
      </div>
    </div>
  );
}

function EmptySearch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-border bg-card px-6 py-14 text-center shadow-[var(--shadow-soft)]" data-testid="empty-search">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-muted-foreground"><Search className="size-5" /></div>
      <h3 className="mt-4 font-serif text-2xl font-semibold">No close matches</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        Nothing in this dataset looks like “{query}”. Try fewer words, or clear the search to browse everything.
      </p>
      <button className="safe-focus mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-secondary" onClick={onClear} data-testid="button-clear-empty-search">
        <X className="size-4" /> Clear search
      </button>
    </div>
  );
}

function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [query, setQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sortAscending, setSortAscending] = useState(true);

  const products = useMemo(() => {
    const groups = new Map<string, Product>();
    offers.forEach((offer) => {
      const existing = groups.get(offer.normalizedProduct);
      if (existing) existing.offers.push(offer);
      else groups.set(offer.normalizedProduct, { key: offer.normalizedProduct, name: offer.productName, offers: [offer] });
    });
    return Array.from(groups.values()).map((product) => ({
      ...product,
      offers: [...product.offers].sort((a, b) => sortAscending ? a.price - b.price : b.price - a.price),
    }));
  }, [offers, sortAscending]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = normalizeProduct(query);
    if (!normalizedQuery) return products;
    return products.filter((product) => product.key.includes(normalizedQuery));
  }, [products, query]);

  const stats = useMemo(() => {
    const uniqueStores = new Set(offers.map((offer) => offer.store));
    return { products: products.length, offers: offers.length, stores: uniqueStores.size };
  }, [offers, products.length]);

  const loadText = async (text: string, name: string) => {
    setStatus('reading');
    setProgress(8);
    setError('');
    setNotice('');
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    try {
      setProgress(72);
      const result = parsePriceCsv(text, name);
      setOffers(result.offers);
      setSourceName(result.sourceName);
      setProgress(100);
      setStatus('ready');
      const details = [
        `${result.offers.length} offers loaded`,
        result.skippedMalformed ? `${result.skippedMalformed} row${result.skippedMalformed === 1 ? '' : 's'} skipped` : '',
        result.invalidUrls ? `${result.invalidUrls} unsafe link${result.invalidUrls === 1 ? '' : 's'} removed` : '',
      ].filter(Boolean).join(' · ');
      setNotice(details);
    } catch (caught) {
      setStatus('error');
      setProgress(0);
      setError(caught instanceof Error ? caught.message : 'This CSV could not be loaded.');
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setStatus('error');
      setError('Please choose a CSV file. Other file types are not read.');
      return;
    }
    try {
      const text = await readFileWithProgress(file, setProgress);
      await loadText(text, file.name);
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'This CSV could not be loaded.');
      setProgress(0);
    }
  };

  const onFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    await handleFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    await handleFile(event.dataTransfer.files?.[0]);
  };

  const clearData = () => {
    setOffers([]);
    setSourceName('');
    setQuery('');
    setNotice('');
    setError('');
    setProgress(0);
    setStatus('idle');
  };

  const loadSample = () => {
    void loadText(SAMPLE_CSV, 'World Price Ghana sample.csv');
  };

  return (
    <div className="paper-grain min-h-[100dvh] bg-background">
      <header className="border-b border-border/80 bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3" data-testid="brand-world-price">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-sm">W</div>
            <div>
              <div className="font-serif text-lg font-semibold leading-none tracking-tight">World Price</div>
              <div className="mt-1 font-mono text-[9px] font-medium uppercase tracking-[.24em] text-accent">Ghana</div>
            </div>
          </div>
          <div className="hidden items-center gap-2.5 text-xs text-muted-foreground sm:flex">
            <ShieldCheck className="size-4 text-[#238a6d]" />
            <span>Runs in your browser</span>
            <span className="text-border">/</span>
            <span>No account needed</span>
          </div>
          <button className="safe-focus inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary" onClick={loadSample} data-testid="button-header-sample">
            <Sparkles className="size-3.5 text-accent" /> Load sample
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[248px_1fr]">
        <aside className="border-b border-border bg-primary px-5 py-7 text-primary-foreground sm:px-8 lg:min-h-[calc(100dvh-73px)] lg:border-b-0 lg:border-r lg:px-6 lg:py-9">
          <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-[#f2c45e]"><span className="size-1.5 rounded-full bg-[#f2c45e]" /> Quick guide</div>
          <h2 className="mt-5 max-w-[180px] font-serif text-3xl leading-[1.02]">Compare with confidence.</h2>
          <div className="mt-8 space-y-6">
            {[
              ['01', 'Bring your prices', 'Upload a CSV from a spreadsheet, or start with the sample.'],
              ['02', 'Search an item', 'Names keep their original casing. Search stays forgiving.'],
              ['03', 'Take the smart option', 'Results are sorted from cheapest to most expensive.'],
            ].map(([number, title, description]) => (
              <div className="flex gap-3" key={number}>
                <span className="font-mono text-[10px] text-[#f2c45e]">{number}</span>
                <div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-primary-foreground/65">{description}</p></div>
              </div>
            ))}
          </div>
          <div className="mt-9 border-t border-primary-foreground/15 pt-6">
            <div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="size-4 text-[#83d4bc]" /> Private by design</div>
            <p className="mt-2 text-xs leading-5 text-primary-foreground/60">Your file stays on this device. Nothing is uploaded to a server.</p>
          </div>
        </aside>

        <main className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <section className="mx-auto max-w-[1120px]">
            <div className="rise-in grid gap-7 lg:grid-cols-[1fr_360px] lg:items-end">
              <div>
                <div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.22em] text-accent"><span className="size-1.5 rounded-full bg-accent" /> Local price desk</div>
                <h1 className="max-w-3xl font-serif text-[clamp(2.75rem,6vw,5.7rem)] font-semibold leading-[.9] tracking-[-.055em] text-primary">Know the price<br /><span className="text-[#bf6c32]">before you go.</span></h1>
                <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">A clear, private way to check the everyday basket across Ghana’s familiar stores. Bring your own price list and make the better stop.</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] lg:mb-1">
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e5f3ee] text-[#238a6d]"><ShieldCheck className="size-4" /></div>
                  <div><p className="text-sm font-semibold">Private, not distant</p><p className="mt-1 text-xs leading-5 text-muted-foreground">No sign-in. No tracking. No price data leaves your browser.</p></div>
                </div>
              </div>
            </div>

            <div
              className={`upload-zone rise-in rise-in-delay-1 mt-10 rounded-[1.25rem] border border-dashed border-[#c6bda9] p-5 transition-colors sm:p-7 ${isDragging ? 'is-dragging' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              data-testid="upload-zone"
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground"><CloudUpload className="size-5" /></div>
                  <div>
                    <h2 className="font-serif text-xl font-semibold">Bring your price list</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Drop a CSV here, or choose one from your device.</p>
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Info className="size-3.5" /> Headers: product, store, price, url</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button className="safe-focus inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }} data-testid="button-choose-csv">
                    <Upload className="size-4" /> Choose CSV
                  </button>
                  <button className="safe-focus inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-semibold hover:bg-secondary" onClick={loadSample} data-testid="button-load-sample">
                    <FileDown className="size-4" /> Sample
                  </button>
                  <input ref={fileInputRef} className="sr-only" type="file" accept=".csv,text/csv" onClick={(event) => event.stopPropagation()} onChange={onFileInput} data-testid="input-csv-file" />
                </div>
              </div>
              {(status === 'reading' || status === 'error' || status === 'ready') && (
                <div className="mt-5 border-t border-border/70 pt-4" data-testid="status-upload">
                  {status === 'reading' && <div><div className="flex items-center justify-between text-xs font-medium"><span className="flex items-center gap-2"><LoaderCircle className="size-3.5 animate-spin text-accent" /> Reading {sourceName || 'your CSV'}…</span><span>{progress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} /></div></div>}
                  {status === 'ready' && <p className="flex items-center gap-2 text-xs font-medium text-[#238a6d]"><Check className="size-4" /> {sourceName} loaded. {notice}</p>}
                  {status === 'error' && <p className="flex items-start gap-2 text-xs font-medium text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}</p>}
                </div>
              )}
            </div>

            <div className="rise-in rise-in-delay-2 mt-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <label className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground" htmlFor="search-products">Search your basket</label>
                <div className="relative max-w-2xl">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input id="search-products" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={offers.length ? 'Try “rice”, “milo” or “soap”' : 'Load a list to start searching'} disabled={!offers.length} className="safe-focus h-12 w-full rounded-xl border border-border bg-card pl-11 pr-11 text-sm shadow-[var(--shadow-soft)] placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-60" data-testid="input-search-products" />
                  {query && <button className="safe-focus absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setQuery('')} aria-label="Clear search" data-testid="button-clear-search"><X className="size-4" /></button>}
                </div>
              </div>
              {offers.length > 0 && (
                <button className="safe-focus inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3.5 text-xs font-semibold hover:bg-secondary" onClick={() => setSortAscending((value) => !value)} data-testid="button-sort-prices">
                  <SlidersHorizontal className="size-4 text-accent" /> {sortAscending ? 'Cheapest first' : 'Most expensive first'} <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
              )}
            </div>

            {offers.length === 0 ? (
              <div className="rise-in rise-in-delay-3 mt-8 rounded-[1.25rem] border border-border bg-card px-6 py-16 text-center shadow-[var(--shadow-soft)]" data-testid="empty-state-no-data">
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-primary"><FileText className="size-6" /></div>
                <h2 className="mt-5 font-serif text-3xl font-semibold">Your price desk is ready.</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">Upload a CSV of products and store prices to see the cheapest option at a glance. Start with the sample if you want to look around first.</p>
                <button className="safe-focus mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90" onClick={loadSample} data-testid="button-empty-load-sample"><Sparkles className="size-4 text-[#f2c45e]" /> Explore sample prices</button>
              </div>
            ) : (
              <>
                <div className="rise-in rise-in-delay-3 mt-6 flex flex-wrap items-center justify-between gap-3">
                  <div><p className="font-serif text-2xl font-semibold">Price board</p><p className="mt-1 text-xs text-muted-foreground">{stats.products} products · {stats.offers} offers · {stats.stores} stores</p></div>
                  <div className="flex items-center gap-2">
                    <span className="max-w-[180px] truncate rounded-md bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground" title={sourceName}>{sourceName}</span>
                    <button className="safe-focus rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={clearData} aria-label="Clear loaded price list" data-testid="button-clear-data"><X className="size-4" /></button>
                  </div>
                </div>
                {filteredProducts.length === 0 ? <div className="mt-5"><EmptySearch query={query} onClear={() => setQuery('')} /></div> : (
                  <div className="mt-5 space-y-4" data-testid="comparison-results">
                    {filteredProducts.map((product, productIndex) => {
                      const best = product.offers[0];
                      return (
                        <article className="store-card overflow-hidden rounded-[1.25rem] border border-border bg-card" key={product.key} data-testid={`card-product-${product.key}`}>
                          <div className="flex flex-col gap-3 border-b border-border bg-secondary/35 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-muted-foreground">{String(productIndex + 1).padStart(2, '0')}</span><h3 className="truncate font-serif text-xl font-semibold" data-testid={`text-product-${product.key}`}>{product.name}</h3></div><p className="mt-1 pl-7 text-xs text-muted-foreground">{product.offers.length} store{product.offers.length === 1 ? '' : 's'} compared</p></div>
                            <div className="flex shrink-0 items-center gap-2 self-start rounded-lg bg-[#e5f3ee] px-2.5 py-1.5 text-[11px] font-semibold text-[#19775d] sm:self-auto"><Check className="size-3.5" /> Best: {formatPrice(best.price)}</div>
                          </div>
                          <div className="divide-y divide-border/80">
                            {product.offers.map((offer, offerIndex) => (
                              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" key={`${product.key}-${offer.store}-${offer.price}`} data-testid={`row-offer-${product.key}-${normalizeProduct(offer.store)}`}>
                                <div className="flex items-center gap-3"><span className={`grid size-6 place-items-center rounded-full font-mono text-[10px] ${offerIndex === 0 ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'}`}>{offerIndex + 1}</span><StoreMark store={offer.store} /></div>
                                <div className="flex items-center justify-between gap-4 pl-9 sm:justify-end sm:pl-0">
                                  <span className={`font-mono text-base font-medium ${offerIndex === 0 ? 'text-[#19775d]' : 'text-foreground'}`} data-testid={`text-price-${product.key}-${normalizeProduct(offer.store)}`}>{formatPrice(offer.price)}</span>
                                  <div className="flex items-center gap-2">
                                    {offer.url ? <a href={offer.url} target="_blank" rel="noopener noreferrer" className="safe-focus inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary" data-testid={`link-store-${product.key}-${normalizeProduct(offer.store)}`}><Link2 className="size-3.5" /> Store <ExternalLink className="size-3" /></a> : <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground" title="This row did not include a safe HTTPS link"><Link2 className="size-3.5" /> No link</span>}
                                    <button className="safe-focus inline-flex items-center gap-1.5 rounded-lg bg-[#238a6d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#19775d]" onClick={() => { const message = `Price check: ${product.name} at ${offer.store} is ${formatPrice(offer.price)}. ${offer.url ? `Check it here: ${offer.url}` : 'Shared from World Price Ghana.'}`; window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer'); }} data-testid={`button-share-${product.key}-${normalizeProduct(offer.store)}`}><span className="font-bold">WA</span> Share</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <footer className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-[#238a6d]" /> Browser-only price checking for Ghana.</p>
              <p className="flex items-center gap-1.5"><ArrowUpDown className="size-3.5" /> Prices are supplied by your CSV.</p>
            </footer>
          </section>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;