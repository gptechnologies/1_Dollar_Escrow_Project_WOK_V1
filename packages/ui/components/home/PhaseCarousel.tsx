"use client";

import * as React from "react";
import {
  Check,
  CircleDollarSign,
  CircleUserRound,
  RotateCcw,
  Send,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

type ActionTone = "confirm" | "fund" | "settle" | "refund" | "unavailable";

type PhaseAction = {
  action: string;
  icon: LucideIcon;
  who: string;
  result: string;
  tone: ActionTone;
};

type PhaseSlide = {
  phase: string;
  title: string;
  description: string;
  nextStep?: string;
  actionsLabel?: string;
  actions: PhaseAction[];
};

const phaseSlides: PhaseSlide[] = [
  {
    phase: "Phase 1",
    title: "Created",
    description: "The escrow is created on-chain. No funds are held yet. Waiting to be funded.",
    nextStep: "Buyer funds the escrow with a direct USDC or USDT transfer.",
    actions: [
      {
        action: "Confirm",
        icon: ShieldCheck,
        who: "Seller",
        result: "Moves toward ACTIVE",
        tone: "confirm",
      },
      {
        action: "Fund",
        icon: CircleDollarSign,
        who: "Buyer",
        result: "Funds held by contract",
        tone: "fund",
      },
      {
        action: "Settle",
        icon: Send,
        who: "Anyone",
        result: "Unavailable",
        tone: "unavailable",
      },
      {
        action: "Refund underfunded",
        icon: RotateCcw,
        who: "Anyone",
        result: "Buyer refunded",
        tone: "refund",
      },
    ],
  },
  {
    phase: "Phase 2",
    title: "Active",
    description: "The seller confirmed a fully funded escrow. Waiting for resolution.",
    nextStep: "Wait for the settlement date, or resolve early by mutual agreement.",
    actions: [
      {
        action: "Settle",
        icon: Send,
        who: "Anyone",
        result: "After settlement date",
        tone: "settle",
      },
      {
        action: "Mutual settle",
        icon: Check,
        who: "Buyer + seller",
        result: "SETTLED",
        tone: "confirm",
      },
      {
        action: "Mutual refund",
        icon: RotateCcw,
        who: "Buyer + seller",
        result: "REFUNDED",
        tone: "refund",
      },
      {
        action: "Arbitrator vote",
        icon: UsersRound,
        who: "Arbitrators",
        result: "SETTLED or REFUNDED",
        tone: "settle",
      },
    ],
  },
  {
    phase: "Phase 3",
    title: "Settlement",
    description: "At or after the settlement date, the escrow resolves by funding status and arbitration setup.",
    nextStep: "Settle a funded escrow, or refund one that remains underfunded.",
    actions: [
      {
        action: "Settle",
        icon: Send,
        who: "Anyone",
        result: "SETTLED",
        tone: "settle",
      },
      {
        action: "Refund underfunded",
        icon: RotateCcw,
        who: "Anyone",
        result: "REFUNDED",
        tone: "refund",
      },
      {
        action: "Mutual settle / refund",
        icon: Check,
        who: "Buyer + seller",
        result: "Agreed outcome",
        tone: "confirm",
      },
      {
        action: "Arbitrator vote",
        icon: UsersRound,
        who: "Arbitrators",
        result: "SETTLED or REFUNDED",
        tone: "settle",
      },
    ],
  },
  {
    phase: "Phase 4",
    title: "Terminal",
    description: "The escrow is resolved. No further actions are available.",
    actionsLabel: "Final outcomes",
    actions: [
      {
        action: "Settled",
        icon: Check,
        who: "No one",
        result: "Seller is paid",
        tone: "confirm",
      },
      {
        action: "Refunded",
        icon: RotateCcw,
        who: "No one",
        result: "Buyer is refunded",
        tone: "refund",
      },
    ],
  },
];

function ActionRow({ item }: { item: PhaseAction }) {
  const Icon = item.icon;

  return (
    <div className={cn("rune-phase-action-row", `is-${item.tone}`)}>
      <span className="rune-phase-action-name">
        <span className="rune-phase-action-icon" aria-hidden>
          <Icon />
        </span>
        <strong>{item.action}</strong>
      </span>
      <span className="rune-phase-action-party">
        <CircleUserRound aria-hidden />
        {item.who}
      </span>
      <span className="rune-phase-action-result">{item.result}</span>
    </div>
  );
}

export default function PhaseCarousel() {
  const [api, setApi] = React.useState<CarouselApi>();
  const [current, setCurrent] = React.useState(0);
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    if (!api) return;

    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap());

    const updateCurrent = () => setCurrent(api.selectedScrollSnap());
    api.on("select", updateCurrent);
    api.on("reInit", updateCurrent);

    return () => {
      api.off("select", updateCurrent);
    };
  }, [api]);

  return (
    <div className="rune-phase-carousel">
      <Carousel setApi={setApi} opts={{ align: "start", loop: false }}>
        <CarouselContent>
          {phaseSlides.map((slide) => (
            <CarouselItem key={slide.title}>
              <Card className="rune-phase-card">
                <CardHeader className="rune-phase-header">
                  <Badge className="rune-phase-number">{slide.phase}</Badge>
                  <CardTitle>{slide.title}</CardTitle>
                  <CardDescription>{slide.description}</CardDescription>
                </CardHeader>
                <CardContent className="rune-phase-content">
                  {slide.nextStep ? (
                    <div className="rune-phase-next">
                      <span className="rune-phase-next-label">Next step</span>
                      <p>
                        <span className="rune-phase-next-icon" aria-hidden>
                          <Send />
                        </span>
                        {slide.nextStep}
                      </p>
                    </div>
                  ) : null}
                  <div className="rune-phase-actions-head">
                    {slide.actionsLabel ?? "Available actions"}
                  </div>
                  <div className="rune-phase-action-list">
                    <div className="rune-phase-action-columns" aria-hidden>
                      <span>Action</span>
                      <span>Who</span>
                      <span>Result</span>
                    </div>
                    {slide.actions.map((item) => (
                      <ActionRow key={item.action} item={item} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="rune-phase-arrow rune-phase-arrow-prev" />
        <CarouselNext className="rune-phase-arrow rune-phase-arrow-next" />
      </Carousel>
      <div className="rune-phase-footer" aria-label="Carousel progress">
        <span>{current + 1} / {count || phaseSlides.length}</span>
        <div>
          {phaseSlides.map((slide, index) => (
            <button
              key={slide.title}
              type="button"
              aria-label={`Go to ${slide.title}`}
              aria-current={current === index ? "true" : undefined}
              onClick={() => api?.scrollTo(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
