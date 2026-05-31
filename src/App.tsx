import React, { useState } from 'react';

function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const generateReport = async () => {
    setLoading(true);
    setMessage('Generating report... this may take some time depending on the number of stocks.');
    try {
      const resp = await fetch('/api/generate-report', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        setMessage('Report generated successfully! You can now download it.');
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = () => {
    window.location.href = '/api/download-report';
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8 font-sans text-slate-900">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 mb-2">Data Keeper</h1>
          <p className="text-slate-500">Generate and download historical volume baselines and highs/lows for tracked stocks.</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={generateReport}
            disabled={loading}
            className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${loading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
          >
            {loading ? 'Processing...' : 'Generate New Report'}
          </button>
          
          <button
            onClick={downloadReport}
            className="w-full py-3 px-4 rounded-lg font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            Download Latest Report.xlsx
          </button>
        </div>

        {message && (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-600">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
