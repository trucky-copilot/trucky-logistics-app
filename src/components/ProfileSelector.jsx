import { useState } from 'react';
import { useProfile, MAX_PROFILES } from '@/lib/ProfileContext';
import { useLanguage } from '@/lib/LanguageContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Plus, Trash2, Edit2 } from 'lucide-react';

export default function ProfileSelector() {
  const { profiles, activeProfile, activeProfileId, switchProfile, addProfile, renameProfile, deleteProfile } = useProfile();
  // We'll use window.prompt for simple rename/add in Fase 1 local.
  // We could use full Dialog component, but let's keep it lightweight first to demo the state.

  if (!activeProfile) return null;

  const handleAdd = () => {
    if (profiles.length >= MAX_PROFILES) {
      alert(`Límite máximo de ${MAX_PROFILES} perfiles alcanzado.`);
      return;
    }
    const name = window.prompt("Nombre del nuevo perfil:");
    if (name && name.trim()) {
      addProfile(name.trim());
    }
  };

  const handleRename = (id, oldName) => {
    const newName = window.prompt("Nuevo nombre para el perfil:", oldName);
    if (newName && newName.trim()) {
      renameProfile(id, newName.trim());
    }
  };

  const handleDelete = (id, name) => {
    if (profiles.length <= 1) {
      alert("No puedes eliminar el único perfil que queda.");
      return;
    }
    if (window.confirm(`¿Seguro que deseas eliminar el perfil "${name}"?`)) {
      deleteProfile(id);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors focus:outline-none">
        <span className="text-xs font-semibold text-foreground truncate max-w-[120px]">
          {activeProfile.name}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Tus Perfiles ({profiles.length}/{MAX_PROFILES})</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {profiles.map(p => (
          <DropdownMenuItem 
            key={p.id} 
            className="flex items-center justify-between group px-2 py-1.5 cursor-pointer"
            onSelect={(e) => {
              const success = switchProfile(p.id);
              if (!success) {
                e.preventDefault(); // Evita que se cierre el menú si cancela
              }
            }}
          >
            <span className={`flex-1 text-sm truncate ${p.id === activeProfileId ? 'font-bold text-primary' : 'text-foreground'}`}>
              {p.id === activeProfileId && <span className="mr-1">✓</span>}
              {p.name}
            </span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={(e) => { e.stopPropagation(); handleRename(p.id, p.name); }}
                className="p-1 text-muted-foreground hover:text-foreground focus:outline-none"
                title="Renombrar"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {profiles.length > 1 && (
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.name); }}
                  className="p-1 text-red-400 hover:text-red-500 focus:outline-none"
                  title="Eliminar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        
        <DropdownMenuItem 
          onSelect={(e) => { e.preventDefault(); handleAdd(); }}
          disabled={profiles.length >= MAX_PROFILES}
          className="text-sm cursor-pointer"
        >
          <Plus className="w-4 h-4 mr-2" />
          Agregar nuevo perfil
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
