import React, { useState, useEffect } from 'react';
import { Database, Download, RefreshCw, FileText, Search } from 'lucide-react';
import { RAW_UNIVERSE } from '../services/marketDataService';

export default function HistoricalDataTab() {
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState('');
  const [syncedFiles, setSyncedFiles] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  
  const fetchFilesList = async () => {
    try {
      const resp = await fetch('/api/historical/files');
      const data = await resp.json();
      if (data.success) setSyncedFiles(data.symbols || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchFilesList();
    const interval = setInterval(fetchFilesList, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    setMessage('Triggering fetch process. The backend is fetching up to 60 days of 5-minute data...');
    try {
      const resp = await fetch('/api/fetch-historical', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setMessage('Historical 5-minute data fetch initiated! Please wait as files download.');
      } else {
        setMessage('Error: ' + data.error);
      }
    } catch (e: any) {
      setMessage('Failed: ' + e.message);
    } finally {
      setDownloading(false);
    }
  };

  const filteredFiles = syncedFiles.filter(symbol => symbol.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Database className="text-indigo-400" size={24} />
        <h2 className="text-xl font-medium text-zinc-100">Historical 5-Minute Data Export</h2>
      </div>

      <div className="prose prose-invert max-w-none text-zinc-400 mb-8">
        <p>
          Yahoo Finance restricts 5-minute interval historical data downloads to a maximum of 60 days.
          If we request more than that, the API fails.
        </p>
        <p>
          You can fetch the maximum available 5-minute data (last 60 days) for all {RAW_UNIVERSE.length} stocks in the universe. Note that this may take a few minutes to process backend requests to avoid rate limits.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 mb-6">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
        >
          {downloading ? <RefreshCw className="animate-spin" size={20} /> : <Database size={20} />}
          {downloading ? 'Queuing Fetch...' : 'Sync Missing 5m Data (All Scope)'}
        </button>

        {syncedFiles.length > 0 && (
          <a
            href="/api/historical/download-all"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
          >
            <Download size={20} /> Download ZIP ({syncedFiles.length} files)
          </a>
        )}
      </div>

      {message && (
        <div className="text-sm bg-zinc-950 px-4 py-3 border border-zinc-800 rounded-lg text-emerald-400 font-mono mb-8">
          {message}
        </div>
      )}
      
      <div className="mt-8 bg-zinc-950/50 p-4 border border-zinc-800/80 rounded-lg">
        <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
          <h3 className="text-zinc-200 font-medium">Available Local Files ({syncedFiles.length})</h3>
          <div className="relative w-64">
             <input 
               type="text" 
               placeholder="Search Symbol..."
               value={search}
               onChange={(e) => setSearch(e.target.value)}
               className="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-lg pl-9 pr-3 py-1.5 focus:border-indigo-500 focus:outline-none"
             />
             <Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
          </div>
        </div>

        {filteredFiles.length === 0 ? (
          <div className="text-center text-zinc-500 py-8">
            {syncedFiles.length === 0 ? "No files synced yet. Click the sync button above." : "No matching symbols found."}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[400px] overflow-y-auto pr-2">
            {filteredFiles.map(sym => (
              <div key={sym} className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors group">
                <span className="font-mono text-sm text-indigo-300">{sym}</span>
                <a 
                  href={`/api/historical/download/${sym}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Download ${sym} as Excel (XLSX)`}
                  className="text-zinc-500 hover:text-emerald-400 transition-colors"
                >
                  <FileText size={16} />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
