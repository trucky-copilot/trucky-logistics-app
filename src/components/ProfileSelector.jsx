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
import { ChevronDown, Plus, Trash2, Edit2 } from 'lucide-react';

export default function ProfileSelector() {
  const { profiles, activeProfile, activeProfileId, switchProfile, addProfile, renameProfile, deleteProfile } = useProfile();
  
  // States for dialogs
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptType, setPromptType] = useState('add'); // 'add' or 'rename'
  const [promptValue, setPromptValue] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteProfileData, setDeleteProfileData] = useState(null);

  if (!activeProfile) {
    return (
      <div className="bg-red-500 text-white px-2 py-1 text-xs font-bold rounded">
        Cargando Perfil...
      </div>
    );
  }

  const openAddPrompt = () => {
    if (profiles.length >= MAX_PROFILES) {
      alert(`Límite máximo de ${MAX_PROFILES} perfiles alcanzado.`);
      return;
    }
    setPromptType('add');
    setPromptValue('');
    setPromptOpen(true);
  };

  const openRenamePrompt = (id, oldName) => {
    setPromptType('rename');
    setSelectedProfileId(id);
    setPromptValue(oldName);
    setPromptOpen(true);
  };

  const handlePromptSubmit = () => {
    if (promptValue && promptValue.trim()) {
      if (promptType === 'add') {
        addProfile(promptValue.trim());
      } else if (promptType === 'rename' && selectedProfileId) {
        renameProfile(selectedProfileId, promptValue.trim());
      }
    }
    setPromptOpen(false);
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
            disabled={profiles.length >= MAX_PROFILES}
            className="text-sm cursor-pointer"
          >
            <Plus className="w-4 h-4 mr-2" />
            Agregar nuevo perfil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Input Dialog (Add / Rename) */}
      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {promptType === 'add' ? 'Crear Nuevo Perfil' : 'Renombrar Perfil'}
            </DialogTitle>
            <DialogDescription>
              {promptType === 'add' 
                ? 'Ingresa un nombre para tu nuevo perfil de configuración.'
                : 'Ingresa un nuevo nombre para este perfil.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 py-2">
            <Input 
              value={promptValue} 
              onChange={(e) => setPromptValue(e.target.value)} 
              placeholder="Nombre del perfil"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePromptSubmit();
              }}
              autoFocus
            />
          </div>
          <DialogFooter className="sm:justify-end">
            <Button variant="outline" onClick={() => setPromptOpen(false)}>Cancelar</Button>
            <Button onClick={handlePromptSubmit}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar Perfil?</AlertDialogTitle>
            <AlertDialogDescription>
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
