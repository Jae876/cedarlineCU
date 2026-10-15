export interface Position {
  symbol: string
  quantity: number
  avgCost: number
  currentPrice: number
  unrealizedPL: number
  unrealizedPLPercent: number
}

export interface Transaction {
  id: string
  transactionId: string
  date: string
  type: string
  amount: number
  description: string
  balance: number | null
  imported?: boolean
  generated?: boolean
  status?: string
  bankName?: string
  destinationAccountLast4?: string
  destinationRoutingNumber?: string
  requestId?: number | null
  receiptAvailable?: boolean
}

export interface Account {
  balance: number
  buyingPower: number
  totalDeposits: number
  unrealizedGains: number
  marginLevel: number
  accountNumber: string
  routingNumber: string
  createdAt: string
  positions: Position[]
  transactions: Transaction[]
}

export interface User {
  id: number
  email: string
  firstName: string
  lastName: string
  address: {
    line1: string
    line2: string
    city: string
    state: string
    postalCode: string
  }
  accountType: string
  account: Account
}

export interface AdminStats {
  totalUsers: number
  activeUsers: number
  totalVolume: number
  totalDeposits: number
  totalAccounts: number
  averageBalance: number
  totalBalance: string
  activeAccounts: number
  pendingRequests: number
}

export interface ApiResult<T> {
  data: T
  token?: string
  user?: User
}
