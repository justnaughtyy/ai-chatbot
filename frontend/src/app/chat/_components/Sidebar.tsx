'use client'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { MoreHorizontal, PlusCircle, Trash, Edit } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'
import { cn } from '@/lib/utils'

interface Room {
  roomId: string
  title: string
  lastUpdated: string
}

// --- ‼️ V36 CHANGE: เพิ่ม Props ---
interface SidebarProps {
  onLinkClick?: () => void // (ฟังก์ชันสำหรับปิด Sheet บนมือถือ)
}

// ‼️ V36 CHANGE: รับ Prop onLinkClick
export function Sidebar({ onLinkClick }: SidebarProps) {
  // --- (โค้ด State ทั้งหมดเหมือนเดิม V35) ---
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()

  const [rooms, setRooms] = useState<Room[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [isDeleting, setIsDeleting] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [newRoomName, setNewRoomName] = useState('')

  const activeRoomId = params.roomId as string

  // --- 1. Fetch "รายการห้องแชท" (V34/V35 - เหมือนเดิม) ---
  useEffect(() => {
    let isMounted = true
    if (user) {
      setIsLoading(true)
      fetch(`http://localhost:3001/api/chat/rooms/${user.uid}`)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch rooms')
          return res.json()
        })
        .then((data: Room[]) => {
          if (isMounted) setRooms(data)
        })
        .catch((err) => {
          console.error('Failed to fetch chat rooms:', err)
          toast.error('Error loading rooms', {
            description: err.message,
          })
        })
        .finally(() => {
          if (isMounted) setIsLoading(false)
        })
    } else {
      setIsLoading(false)
      setRooms([])
    }
    return () => {
      isMounted = false
    }
  }, [user])

  // --- 2. Logic ปุ่ม "New Chat" ---
  const handleNewChat = () => {
    const newRoomId = uuidv4()
    router.push(`/chat/${newRoomId}`)
    onLinkClick?.() // ‼️ V36 CHANGE: ปิด Sheet (ถ้าอยู่บนมือถือ)
  }

  // --- 3. Logic การลบห้อง (Delete) ---
  const handleDeleteRoom = async () => {
    if (!selectedRoom) return
    setIsDeleting(true)

    try {
      await fetch(
        `http://localhost:3001/api/chat/room/${selectedRoom.roomId}`,
        {
          method: 'DELETE',
        }
      )
      setRooms((prevRooms) =>
        prevRooms.filter((room) => room.roomId !== selectedRoom.roomId)
      )
      toast.success('Chat Deleted', {
        description: `Room "${selectedRoom.title}" has been deleted.`,
      })

      if (activeRoomId === selectedRoom.roomId) {
        router.push('/chat')
        onLinkClick?.() // ‼️ V36 CHANGE: ปิด Sheet (ถ้าอยู่บนมือถือ)
      }
    } catch (err) {
      toast.error('Error deleting room')
    } finally {
      setIsDeleting(false)
      setSelectedRoom(null)
    }
  }

  // --- 4. Logic การเปลี่ยนชื่อ (Rename) ---
  const handleRenameRoom = async () => {
    if (!selectedRoom || !newRoomName.trim()) return
    setIsRenaming(true)

    const oldTitle = selectedRoom.title
    const optimisticNewTitle = newRoomName.trim()

    setRooms((prevRooms) =>
      prevRooms.map((room) =>
        room.roomId === selectedRoom.roomId
          ? { ...room, title: optimisticNewTitle }
          : room
      )
    )

    try {
      await fetch(
        `http://localhost:3001/api/chat/room/${selectedRoom.roomId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: optimisticNewTitle }),
        }
      )
      toast.success('Chat Renamed', {
        description: `Room "${oldTitle}" is now "${optimisticNewTitle}".`,
      })
    } catch (err) {
      setRooms((prevRooms) =>
        prevRooms.map((room) =>
          room.roomId === selectedRoom.roomId
            ? { ...room, title: oldTitle }
            : room
        )
      )
      toast.error('Error renaming room')
    } finally {
      setIsRenaming(false)
      setSelectedRoom(null)
      setNewRoomName('')
    }
  }

  return (
    <>
      {/* --- Sidebar UI --- */}
      <div className="flex flex-col h-full p-2 bg-muted/50">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={handleNewChat}
        >
          <PlusCircle size={16} />
          New Chat
        </Button>

        <nav className="mt-4 flex flex-col gap-1">
          <p className="px-3 text-xs font-medium text-muted-foreground">
            Recent
          </p>
          {isLoading ? (
            <p className="px-3 text-xs text-muted-foreground">Loading rooms...</p>
          ) : rooms.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">No recent chats.</p>
          ) : (
            rooms.map((room) => (
              <div
                key={room.roomId}
                className={cn(
                  'flex items-center justify-between rounded-md group',
                  activeRoomId === room.roomId ? 'bg-accent' : 'hover:bg-accent'
                )}
              >
                <Button
                  variant="ghost"
                  className="flex-1 w-full justify-start truncate" // ‼️ V35.6 FIX: ใช้ flex-1
                  asChild
                >
                  {/* ‼️ V36 CHANGE: เพิ่ม onClick เพื่อปิด Sheet */}
                  <Link
                    href={`/chat/${room.roomId}`}
                    onClick={() => onLinkClick?.()}
                  >
                    {room.title || 'Untitled Chat'}
                  </Link>
                </Button>
                {/* --- Dropdown Menu --- */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'h-8 w-8 flex-shrink-0', // ‼️ V35.6 FIX: เพิ่ม flex-shrink-0
                        activeRoomId === room.roomId
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100'
                      )}
                    >
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedRoom(room)
                        setNewRoomName(room.title)
                        setIsRenaming(true)
                      }}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-500"
                      onClick={() => {
                        setSelectedRoom(room)
                        setIsDeleting(true)
                      }}
                    >
                      <Trash className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </nav>
      </div>

      {/* --- Dialogs (เหมือนเดิม V35) --- */}
      <Dialog open={isRenaming} onOpenChange={setIsRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>
              Enter a new name for this chat.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name
              </Label>
              <Input
                id="name"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsRenaming(false)}>Cancel</Button>
            <Button onClick={handleRenameRoom}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={isDeleting} onOpenChange={setIsDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              chat history for "{selectedRoom?.title}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={handleDeleteRoom}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}