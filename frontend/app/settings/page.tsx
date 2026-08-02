import { Nav } from '@/components/nav';
import { SettingsForm } from './settings-form';

export default function SettingsPage() {
  return (
    <>
      <Nav />
      <main className="container py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-6">Settings</h1>
        <SettingsForm />
      </main>
    </>
  );
}
