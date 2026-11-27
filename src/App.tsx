/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { Component, useState } from 'react';
import { AdminPanel } from './components/AdminPanel.tsx';
import { PassengerApp } from './components/PassengerApp.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { TransitProvider } from './contexts/TransitContext.tsx';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Erro inesperado na interface.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F3EBDD] text-[#292D26] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-[#292D26]/12 bg-[#FFFDF8] p-6 shadow-sm space-y-4">
            <h1 className="font-display text-xl font-bold">
              Algo interrompeu a exibição
            </h1>
            <p className="text-sm text-[#74766C]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-11 w-full rounded-xl bg-[#A8D929] text-sm font-bold text-[#292D26] cursor-pointer"
            >
              Recarregar plataforma
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const [mode, setMode] = useState<'passenger' | 'admin'>('passenger');

  return mode === 'passenger' ? (
    <PassengerApp onSwitchToAdmin={() => setMode('admin')} />
  ) : (
    <AdminPanel onSwitchToPassenger={() => setMode('passenger')} />
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <TransitProvider>
          <AppShell />
        </TransitProvider>
      </AuthProvider>
    </AppErrorBoundary>
  );
}
