import type { UserSummary } from '@uon/shared/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Mic, MicOff, PhoneOff, Signal, UserPlus, Users, Video, VideoOff, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar, Badge, Button, Card, ConfirmDialog, Dialog, ErrorState, Field, Input, Notice, Spinner } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { useToast } from '@/lib/toast';
import { PeoplePicker } from './Chat';

interface MeetingDetail {
  id: string;
  title: string;
  provider: 'webrtc' | 'teams';
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  scheduledStartAt: string | null;
  externalJoinUrl: string | null;
  conversationId: string | null;
  me: { role: 'host' | 'participant'; inviteStatus: 'invited' | 'accepted' | 'declined' };
  participants: (UserSummary & { role: string; inviteStatus: string; joinedAt: string | null; leftAt: string | null })[];
}

interface Peer {
  socketId: string;
  userId: string;
  name: string;
  stream: MediaStream | null;
  state: RTCPeerConnectionState | 'new';
  audio: boolean;
  video: boolean;
}

type Phase = 'lobby' | 'joining' | 'in-call' | 'left' | 'ended';

export default function CallPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['meeting', id], queryFn: () => get<MeetingDetail>(`/meetings/${id}`), refetchInterval: 15_000 });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  if (q.data.provider === 'teams') return <TeamsMeeting m={q.data} />;
  return <WebRtcCall meeting={q.data} />;
}

function TeamsMeeting({ m }: { m: MeetingDetail }) {
  return (
    <PageContainer>
      <Link to="/reunioes" className="text-[13px] text-fg-3 hover:underline">Reuniões</Link>
      <h1 className="mt-1 mb-4 text-[22px] font-semibold">{m.title}</h1>
      <Card className="space-y-3 p-5">
        <p className="text-sm">Reunião do Microsoft Teams{m.scheduledStartAt ? ` · ${formatDateTime(m.scheduledStartAt)}` : ''}.</p>
        {m.externalJoinUrl ? (
          <a href={m.externalJoinUrl} target="_blank" rel="noopener noreferrer"><Button variant="primary" icon={<ExternalLink className="size-4" />}>Entrar no Teams</Button></a>
        ) : (
          <Notice tone="warning">O link do Teams não está disponível.</Notice>
        )}
      </Card>
    </PageContainer>
  );
}

function WebRtcCall({ meeting }: { meeting: MeetingDetail }) {
  const me = useMe();
  const { config } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>(meeting.status === 'ended' || meeting.status === 'cancelled' ? 'ended' : 'lobby');
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const [signalling, setSignalling] = useState<'ok' | 'lost'>('ok');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState(meeting.title);
  const [endOpen, setEndOpen] = useState(false);

  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const iceServers = useRef<RTCIceServer[]>([]);
  const localRef = useRef<MediaStream | null>(null);
  const joinedRef = useRef(false);

  const updatePeer = useCallback((socketId: string, patch: Partial<Peer>) => {
    setPeers((m) => {
      const cur = m.get(socketId);
      if (!cur && !patch.userId) return m;
      const next = new Map(m);
      next.set(socketId, { socketId, userId: '', name: '', stream: null, state: 'new', audio: true, video: true, ...cur, ...patch });
      return next;
    });
  }, []);

  const removePeer = useCallback((socketId: string) => {
    pcs.current.get(socketId)?.close();
    pcs.current.delete(socketId);
    setPeers((m) => {
      const n = new Map(m);
      n.delete(socketId);
      return n;
    });
  }, []);

  // 1) Local media preview (the call works receive-only if no device / permission).
  useEffect(() => {
    if (phase !== 'lobby' || localRef.current) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        localRef.current = s;
        setLocal(s);
      })
      .catch(async (err: Error) => {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
          localRef.current = audioOnly;
          setLocal(audioOnly);
          setVideoOn(false);
          setMediaError('Câmera indisponível — entrando somente com áudio.');
        } catch {
          setMediaError(err.name === 'NotAllowedError' ? 'Acesso à câmera e ao microfone negado. Você pode entrar apenas para ver e ouvir.' : 'Nenhum microfone ou câmera disponível. Você pode entrar apenas para ver e ouvir.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  // Stop devices when leaving the page.
  useEffect(
    () => () => {
      localRef.current?.getTracks().forEach((t) => t.stop());
      pcs.current.forEach((pc) => pc.close());
      if (joinedRef.current) getSocket().emit('call:leave', { meetingId: meeting.id });
    },
    [meeting.id],
  );

  const createPc = useCallback(
    (peer: { socketId: string; userId: string; name: string }) => {
      const s = getSocket();
      const pc = new RTCPeerConnection({ iceServers: iceServers.current });
      pcs.current.set(peer.socketId, pc);
      updatePeer(peer.socketId, { ...peer, state: 'new' });
      localRef.current?.getTracks().forEach((t) => pc.addTrack(t, localRef.current!));
      if (!localRef.current) {
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.addTransceiver('video', { direction: 'recvonly' });
      }
      pc.onicecandidate = (e) => e.candidate && s.emit('call:signal', { meetingId: meeting.id, to: peer.socketId, data: { type: 'candidate', candidate: e.candidate.toJSON() } });
      pc.ontrack = (e) => updatePeer(peer.socketId, { stream: e.streams[0] ?? new MediaStream([e.track]) });
      pc.onconnectionstatechange = () => {
        updatePeer(peer.socketId, { state: pc.connectionState });
        if (pc.connectionState === 'failed') pc.restartIce();
      };
      return pc;
    },
    [meeting.id, updatePeer],
  );

  const join = useCallback(async () => {
    setPhase('joining');
    const s = getSocket();
    const res = (await s.timeout(8000).emitWithAck('call:join', { meetingId: meeting.id }).catch(() => ({ ok: false, error: 'timeout' }))) as
      | { ok: true; peers: { socketId: string; userId: string; name: string }[]; iceServers: RTCIceServer[] }
      | { ok: false; error: string };
    if (!res.ok) {
      setPhase('lobby');
      const msg: Record<string, string> = { full: `A chamada atingiu o limite de ${config?.calls.maxParticipants} participantes.`, ended: 'A chamada já foi encerrada.', not_found: 'Você não participa desta chamada.', timeout: 'Servidor de tempo real indisponível. Tente novamente.' };
      toast.error('Não foi possível entrar', msg[res.error] ?? res.error);
      return;
    }
    joinedRef.current = true;
    iceServers.current = res.iceServers;
    setPhase('in-call');
    s.emit('call:media', { meetingId: meeting.id, audio: audioOn, video: videoOn && !!localRef.current?.getVideoTracks().length });
    // The newcomer makes the offers → no offer collisions in a mesh.
    for (const p of res.peers) {
      const pc = createPc(p);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      s.emit('call:signal', { meetingId: meeting.id, to: p.socketId, data: { type: 'offer', sdp: offer.sdp } });
    }
    void qc.invalidateQueries({ queryKey: ['meeting', meeting.id] });
  }, [meeting.id, createPc, audioOn, videoOn, config, toast, qc]);

  // Auto-join when coming from "Iniciar chamada".
  const autoJoined = useRef(false);
  useEffect(() => {
    if (phase === 'lobby' && params.get('entrar') && !autoJoined.current && (local || mediaError)) {
      autoJoined.current = true;
      void join();
    }
  }, [phase, params, local, mediaError, join]);

  // 2) Signalling events.
  useEffect(() => {
    const s = getSocket();
    const onJoined = (p: { socketId: string; userId: string; name: string }) => {
      if (!joinedRef.current) return;
      if (!pcs.current.has(p.socketId)) createPc(p);
    };
    const onSignal = async (p: { from: string; userId: string; data: { type: string; sdp?: string; candidate?: RTCIceCandidateInit } }) => {
      if (!joinedRef.current) return;
      let pc = pcs.current.get(p.from);
      if (!pc) pc = createPc({ socketId: p.from, userId: p.userId, name: '' });
      try {
        if (p.data.type === 'offer') {
          await pc.setRemoteDescription({ type: 'offer', sdp: p.data.sdp! });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          s.emit('call:signal', { meetingId: meeting.id, to: p.from, data: { type: 'answer', sdp: answer.sdp } });
          s.emit('call:media', { meetingId: meeting.id, audio: audioOnRef.current, video: videoOnRef.current });
        } else if (p.data.type === 'answer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: p.data.sdp! });
        } else if (p.data.type === 'candidate' && p.data.candidate) {
          await pc.addIceCandidate(p.data.candidate);
        }
      } catch (err) {
        console.warn('signalling error', err);
      }
    };
    const onLeft = (p: { socketId: string }) => removePeer(p.socketId);
    const onMedia = (p: { socketId: string; audio: boolean; video: boolean }) => updatePeer(p.socketId, { audio: p.audio, video: p.video });
    const onEnded = () => {
      setPhase('ended');
      pcs.current.forEach((pc) => pc.close());
      pcs.current.clear();
      setPeers(new Map());
      joinedRef.current = false;
      localRef.current?.getTracks().forEach((t) => t.stop());
      void qc.invalidateQueries({ queryKey: ['meeting', meeting.id] });
    };
    const onDisconnect = () => setSignalling('lost');
    const onConnect = () => {
      setSignalling('ok');
      // Signalling came back after a drop: rejoin and rebuild the connections.
      if (joinedRef.current) {
        pcs.current.forEach((pc) => pc.close());
        pcs.current.clear();
        setPeers(new Map());
        void join();
      }
    };
    s.on('call:peer-joined', onJoined);
    s.on('call:signal', onSignal);
    s.on('call:peer-left', onLeft);
    s.on('call:media', onMedia);
    s.on('call:ended', onEnded);
    s.on('disconnect', onDisconnect);
    s.on('connect', onConnect);
    return () => {
      s.off('call:peer-joined', onJoined);
      s.off('call:signal', onSignal);
      s.off('call:peer-left', onLeft);
      s.off('call:media', onMedia);
      s.off('call:ended', onEnded);
      s.off('disconnect', onDisconnect);
      s.off('connect', onConnect);
    };
  }, [meeting.id, createPc, removePeer, updatePeer, join, qc]);

  const audioOnRef = useRef(audioOn);
  const videoOnRef = useRef(videoOn);
  audioOnRef.current = audioOn;
  videoOnRef.current = videoOn;

  const toggleAudio = () => {
    const v = !audioOn;
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = v));
    setAudioOn(v);
    if (joinedRef.current) getSocket().emit('call:media', { meetingId: meeting.id, audio: v, video: videoOn });
  };
  const toggleVideo = () => {
    const v = !videoOn;
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = v));
    setVideoOn(v);
    if (joinedRef.current) getSocket().emit('call:media', { meetingId: meeting.id, audio: audioOn, video: v });
  };
  const leave = () => {
    getSocket().emit('call:leave', { meetingId: meeting.id });
    joinedRef.current = false;
    pcs.current.forEach((pc) => pc.close());
    pcs.current.clear();
    setPeers(new Map());
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocal(null);
    setPhase('left');
  };

  const endForAll = useMutation({ mutationFn: () => post(`/meetings/${meeting.id}/end`), onSuccess: () => setEndOpen(false), onError: (e) => toast.error('Não foi possível encerrar', e) });
  const invite = useMutation({ mutationFn: (ids: string[]) => post(`/meetings/${meeting.id}/participants`, { userIds: ids }), onSuccess: () => { toast.success('Convites enviados'); void qc.invalidateQueries({ queryKey: ['meeting', meeting.id] }); }, onError: (e) => toast.error('Não foi possível convidar', e) });
  const toGroup = useMutation({ mutationFn: () => post<{ id: string }>(`/meetings/${meeting.id}/create-group`, { name: groupName }), onSuccess: (r) => { toast.success('Grupo criado'); navigate(`/conversas/${r.id}`); }, onError: (e) => toast.error('Não foi possível criar o grupo', e) });
  const isHost = meeting.me.role === 'host';
  const peerList = [...peers.values()];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0f0f0e] text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <Link to="/reunioes" className="text-[13px] text-white/60 hover:underline">Reuniões</Link>
        <h1 className="truncate text-[15px] font-semibold">{meeting.title}</h1>
        {phase === 'in-call' && <Badge tone="success" icon={<Signal className="size-3" />}>Na chamada</Badge>}
        {signalling === 'lost' && phase === 'in-call' && <Badge tone="warning" icon={<WifiOff className="size-3" />}>Reconectando…</Badge>}
        <span className="ml-auto text-xs text-white/60">{peerList.length + (phase === 'in-call' ? 1 : 0)} na chamada · máx. {config?.calls.maxParticipants}</span>
      </header>

      {phase === 'ended' || phase === 'left' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-lg font-semibold">{phase === 'ended' ? 'A chamada foi encerrada.' : 'Você saiu da chamada.'}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {phase === 'left' && meeting.status !== 'ended' && <Button onClick={() => setPhase('lobby')}>Entrar novamente</Button>}
            <Button onClick={() => setGroupOpen(true)} icon={<Users className="size-4" />}>Criar grupo com os participantes</Button>
            <Link to="/reunioes"><Button variant="primary">Voltar às reuniões</Button></Link>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-fr gap-3 overflow-y-auto p-3 sm:p-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${peerList.length > 2 ? 280 : 360}px), 1fr))` }}>
          <VideoTile name={`${me.user.displayName} (você)`} stream={local} muted mirrored audio={audioOn} video={videoOn && !!local?.getVideoTracks().length} state={phase === 'in-call' ? 'connected' : 'new'} />
          {peerList.map((p) => (
            <VideoTile key={p.socketId} name={p.name || meeting.participants.find((x) => x.id === p.userId)?.displayName || 'Participante'} stream={p.stream} audio={p.audio} video={p.video} state={p.state} />
          ))}
          {phase === 'in-call' && peerList.length === 0 && (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-white/60">
              Aguardando os outros participantes entrarem…
            </div>
          )}
        </div>
      )}

      {phase !== 'ended' && phase !== 'left' && (
        <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          {mediaError && <p className="w-full text-center text-xs text-amber-300" role="status">{mediaError}</p>}
          {!config?.calls.turnConfigured && phase === 'lobby' && <p className="w-full text-center text-xs text-white/50">Sem servidor TURN configurado: chamadas entre redes diferentes podem não conectar (veja a documentação).</p>}
          <CallButton label={audioOn ? 'Desativar microfone' : 'Ativar microfone'} active={audioOn} onClick={toggleAudio} disabled={!local?.getAudioTracks().length}>
            {audioOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
          </CallButton>
          <CallButton label={videoOn ? 'Desativar câmera' : 'Ativar câmera'} active={videoOn} onClick={toggleVideo} disabled={!local?.getVideoTracks().length}>
            {videoOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
          </CallButton>
          {phase === 'lobby' || phase === 'joining' ? (
            <Button variant="primary" size="lg" loading={phase === 'joining'} onClick={() => void join()}>Entrar na chamada</Button>
          ) : (
            <>
              {isHost && <CallButton label="Convidar participantes" onClick={() => setInviteOpen(true)}><UserPlus className="size-5" /></CallButton>}
              <CallButton label="Criar grupo com os participantes" onClick={() => setGroupOpen(true)}><Users className="size-5" /></CallButton>
              <Button variant="danger" size="lg" icon={<PhoneOff className="size-5" />} onClick={leave}>Sair</Button>
              {isHost && <Button variant="ghost" className="text-white/80 hover:bg-white/10" onClick={() => setEndOpen(true)}>Encerrar para todos</Button>}
            </>
          )}
        </footer>
      )}
      <PeoplePicker open={inviteOpen} onOpenChange={setInviteOpen} exclude={meeting.participants.map((p) => p.id)} title="Convidar para a chamada" confirmLabel="Convidar" onConfirm={(ids) => invite.mutate(ids)} />
      <Dialog open={groupOpen} onOpenChange={setGroupOpen} title="Criar grupo com os participantes" description={`Será criado um grupo de conversa com ${meeting.participants.filter((p) => p.inviteStatus !== 'declined').length} pessoas desta chamada.`} footer={<><Button onClick={() => setGroupOpen(false)}>Cancelar</Button><Button variant="primary" loading={toGroup.isPending} disabled={groupName.trim().length < 2} onClick={() => toGroup.mutate()}>Criar grupo</Button></>}>
        <Field label="Nome do grupo" required>{(fid) => <Input id={fid} value={groupName} onChange={(e) => setGroupName(e.target.value)} />}</Field>
      </Dialog>
      <ConfirmDialog open={endOpen} onOpenChange={setEndOpen} title="Encerrar a chamada para todos?" tone="danger" confirmLabel="Encerrar" loading={endForAll.isPending} onConfirm={() => endForAll.mutate()} />
    </div>
  );
}

function CallButton({ label, active = true, onClick, disabled, children }: { label: string; active?: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} aria-pressed={active} onClick={onClick} disabled={disabled} className={cn('flex size-11 items-center justify-center rounded-full transition-colors disabled:opacity-40', active ? 'bg-white/10 hover:bg-white/20' : 'bg-red-600 hover:bg-red-500')}>
      {children}
    </button>
  );
}

const STATE_LABEL: Record<string, string> = { new: 'Conectando…', connecting: 'Conectando…', connected: '', disconnected: 'Conexão instável — reconectando…', failed: 'Falha de conexão — tentando novamente…', closed: 'Desconectado' };

function VideoTile({ name, stream, muted, mirrored, audio, video, state }: { name: string; stream: MediaStream | null; muted?: boolean; mirrored?: boolean; audio: boolean; video: boolean; state: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  const label = STATE_LABEL[state];
  return (
    <div className="relative min-h-[180px] overflow-hidden rounded-xl bg-[#1d1d1b]" data-testid="video-tile" data-state={state}>
      <video ref={ref} autoPlay playsInline muted={muted} className={cn('size-full object-cover', mirrored && '-scale-x-100', !video && 'invisible')} />
      {!video && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar name={name.replace(' (você)', '')} size={72} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-[13px]">
        {!audio && <MicOff className="size-4 text-red-400" aria-label="Microfone desativado" />}
        <span className="truncate">{name}</span>
        {label && <span className="ml-auto text-xs text-amber-300" role="status">{label}</span>}
      </div>
    </div>
  );
}
