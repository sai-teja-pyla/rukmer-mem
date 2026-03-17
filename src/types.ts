export interface UserProfile {
  uid: string
  email: string
  name: string
  photo?: string
}

export interface Message {
  id: string
  text: string
  sender: 'user' | 'bot'
  timestamp: string
}

export interface Chat {
  id: string
  title?: string
  projectName?: string
  dateGroup: 'Today' | 'Yesterday' | 'Previous 7 Days'
  messages: Message[]
}

export interface AppConnection {
  id: string
  name: string
  status: 'connected' | 'disconnected'
  icon: string
}