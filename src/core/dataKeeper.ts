export interface StockData {
    name: string;
    symbol: string;
    mstockToken: string;
}

export const INITIAL_STOCKS: StockData[] = [
    { name: "SIRCA", mstockToken: "11050", symbol: "SIRCA" },
    { name: "UCOBANK", mstockToken: "11223", symbol: "UCOBANK" },
    { name: "SUVEN", mstockToken: "11233", symbol: "SUVEN" },
];

export class DataKeeper {
    private static data: Map<string, StockData> = new Map();

    public static initialize() {
        this.data.clear();
        INITIAL_STOCKS.forEach(stock => {
            this.addStock(stock);
        });
    }

    public static getStock(symbol: string): StockData | undefined {
        return this.data.get(symbol.toUpperCase());
    }

    public static getAllStocks(): StockData[] {
        return Array.from(this.data.values());
    }

    public static addStock(stock: StockData) {
        this.data.set(stock.symbol.toUpperCase(), stock);
    }

    public static removeStock(symbol: string) {
        this.data.delete(symbol.toUpperCase());
    }
}

// Initialize with default data
DataKeeper.initialize();
