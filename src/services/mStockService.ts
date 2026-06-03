let _token: string | null = null;
let clientWrapper: any = {
    getAccessToken: () => _token,
    placeOrder: async (params: any) => {
        console.log("Mock placing order:", params);
        return { orderid: `mock_${Date.now()}` };
    }
};

export const getMConnectClient = async () => {
    return clientWrapper;
};

export const getActiveSessionToken = (): string | null => {
    return _token; 
};

export const setActiveSessionToken = (token: string) => {
    _token = token;
};
