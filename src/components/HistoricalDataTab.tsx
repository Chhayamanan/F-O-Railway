import React, { useState, useEffect } from 'react';
import { Database, Download, RefreshCw } from 'lucide-react';
import { RAW_UNIVERSE } from '../services/marketDataService';

export default function HistoricalDataTab() {
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState('');
  
  const handleDownload = async () => {
    setDownloading(true);
    setMessage('Triggering fetch process...');
    try {
      const resp = await fetch('/api/fetch-historical', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setMessage('Historical 5-minute data fetch completed! Note: Yahoo Finance enforces max 60-day limit for 5m interval.');
      } else {
        setMessage('Error: ' + data.error);
      }
    } catch (e: any) {
      setMessage('Failed: ' + e.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Database className="text-indigo-400" size={24} />
        <h2 className="text-xl font-medium text-zinc-100">Historical 5-Minute Data</h2>
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

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
        >
          {downloading ? <RefreshCw className="animate-spin" size={20} /> : <Download size={20} />}
          {downloading ? 'Fetching...' : 'Fetch 5-Minute Data (Last 60 Days)'}
        </button>
        {message && (
          <div className="flex-1 text-sm bg-zinc-950 px-4 py-3 border border-zinc-800 rounded-lg text-emerald-400 font-mono">
            {message}
          </div>
        )}
      </div>
      
      <div className="mt-8 bg-zinc-950 p-4 border border-zinc-800 rounded-lg text-sm text-zinc-500">
        <p>The system stores downloaded JSON data in the <code className="text-indigo-300">/historical_data_5m</code> directory of the server container. The system currently stores up to 60 days sequentially in local storage.</p>
      </div>
    </div>
  );
}
