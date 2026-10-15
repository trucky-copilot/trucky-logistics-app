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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, Plus, Trash2, Edit2, AlertCircle } from 'lucide-react';

export default function ProfileSelector() {
  const { profiles, activeProfile, activeProfileId, switchProfile, addProfile, renameProfile, deleteProfile } = useProfile();
  
  // States for dialogs
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptType, setPromptType] = useState('add'); // 'add' or 'rename'
  const [promptValue, setPromptValue] = useState('');
  const [nameError, setNameError] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  
  const [limitOpen, setLimitOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteProfileData, setDeleteProfileData] = useState(null);

  if (!activeProfile) {
    return (
      <div className="bg-red-500 text-white px-2 py-1 text-xs font-bold rounded">
        Cargando Perfil...
      </div>
    );
  }

  const checkDuplicate = (name, type = promptType, targetId = selectedProfileId) => {
    const trimmed = (name || '').trim().toLowerCase();
    if (!trimmed) return false;
    return profiles.some(p => {
      if (type === 'rename' && p.id === targetId) return false;
      return p.name.trim().toLowerCase() === trimmed;
    });
  };

  const handleNameChange = (val) => {
    setPromptValue(val);
    if (!val.trim()) {
      setNameError('');
      return;
    }
    if (checkDuplicate(val)) {
      setNameError('Ya existe un perfil con este nombre.');
    } else {
      setNameError('');
    }
  };

  const openAddPrompt = () => {
    if (profiles.length >= MAX_PROFILES) {
      setLimitOpen(true);
      return;
    }
    setPromptType('add');
    setSelectedProfileId(null);
    setPromptValue('');
    setNameError('');
    setPromptOpen(true);
  };

  const openRenamePrompt = (id, oldName) => {
    setPromptType('rename');
    setSelectedProfileId(id);
    setPromptValue(oldName);
    setNameError('');
    setPromptOpen(true);
  };

  const handlePromptSubmit = () => {
    const trimmed = promptValue.trim();
    if (!trimmed) return;

    if (checkDuplicate(trimmed)) {
      setNameError('Ya existe un perfil con este nombre.');
      return;
    }

    if (promptType === 'add') {
      addProfile(trimmed);
    } else if (promptType === 'rename' && selectedProfileId) {
      renameProfile(selectedProfileId, trimmed);
    }
    setPromptOpen(false);
    setNameError('');
  };

  const openDeleteConfirm = (id, name) => {
    if (profiles.length <= 1) {
      alert("No puedes eliminar el único perfil que queda.");
      return;
    }
    setDeleteProfileData({ id, name });
    setDeleteOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (deleteProfileData?.id) {
      deleteProfile(deleteProfileData.id);
    }
    setDeleteOpen(false);
  };

  return (
    <>
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
                  e.preventDefault();
                }
              }}
            >
              <span className={`flex-1 text-sm truncate ${p.id === activeProfileId ? 'font-bold text-primary' : 'text-foreground'}`}>
                {p.id === activeProfileId && <span className="mr-1">✓</span>}
                {p.name}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={(e) => { e.stopPropagation(); openRenamePrompt(p.id, p.name); }}
                  className="p-1 text-muted-foreground hover:text-foreground focus:outline-none"
                  title="Renombrar"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                {profiles.length > 1 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); openDeleteConfirm(p.id, p.name); }}
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
            onSelect={(e) => { e.preventDefault(); openAddPrompt(); }}
            className="text-sm cursor-pointer"
          >
            <Plus className="w-4 h-4 mr-2" />
            Agregar nuevo perfil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Input Dialog (Add / Rename) */}
      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="sm:max-w-md bg-card border border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {promptType === 'add' ? 'Crear Nuevo Perfil' : 'Renombrar Perfil'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              {promptType === 'add' 
                ? 'Ingresa un nombre para tu nuevo perfil de configuración.'
                : 'Ingresa un nuevo nombre para este perfil.'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input 
              value={promptValue} 
              onChange={(e) => handleNameChange(e.target.value)} 
              placeholder="Nombre del perfil"
              className={`w-full bg-muted border ${nameError ? 'border-red-500 focus-visible:ring-red-500/50' : 'border-border'}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !nameError && promptValue.trim()) handlePromptSubmit();
              }}
              autoFocus
            />
            {nameError && (
              <span className="text-xs text-red-400 block mt-1.5 font-medium">
                * {nameError}
              </span>
            )}
          </div>
          <DialogFooter className="sm:justify-end gap-2">
            <Button variant="outline" onClick={() => { setPromptOpen(false); setNameError(''); }}>
              Cancelar
            </Button>
            <Button 
              onClick={handlePromptSubmit} 
              disabled={!!nameError || !promptValue.trim()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Limit Reached Dialog */}
      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogContent className="sm:max-w-md bg-card border border-border text-center p-6 rounded-2xl shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-yellow-500/10 text-yellow-400 mx-auto flex items-center justify-center mb-2">
            <AlertCircle className="w-6 h-6" />
          </div>
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-center text-foreground">
              Alcanzaste el límite de la cantidad de perfiles
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-muted-foreground mt-1.5">
              Has alcanzado el límite máximo de {MAX_PROFILES} perfiles permitidos en tu cuenta. Para agregar uno nuevo, elimina o renombra alguno de los existentes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center mt-4">
            <Button 
              onClick={() => setLimitOpen(false)} 
              className="px-6 py-2 rounded-xl bg-primary hover:bg-primary/90 text-sm font-semibold text-primary-foreground"
            >
              Aceptar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-card border border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">¿Eliminar Perfil?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-xs">
              ¿Estás seguro de que deseas eliminar el perfil "{deleteProfileData?.name}"? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteOpen(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
